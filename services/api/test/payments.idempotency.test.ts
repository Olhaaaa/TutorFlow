/**
 * Головний інваріант платежів: **повторний вебхук не подвоює гроші**.
 *
 * Провайдер повторює доставку, доки не отримає 2xx, і цілком може надіслати
 * той самий успішний статус двічі одночасно. Тому перевіряється не «чи
 * працює обробник», а чи витримує він паралельні дублікати.
 *
 * Тест має сенс ЛИШЕ проти справжнього PostgreSQL: уся гарантія тримається на
 * тому, що база серіалізує одночасні UPDATE одного рядка. У базі в памʼяті
 * зелений тест тут нічого не доводив би.
 *
 * Потрібна піднята локальна база: docker compose -f compose.dev.yml up -d
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDatabase } from '../src/db/database.module.js';
import { TransactionsRepository } from '../src/billing/transactions.repository.js';
import { PaymentsRepository } from '../src/payments/payments.repository.js';

const db = createDatabase();
const payments = new PaymentsRepository(db);
const transactions = new TransactionsRepository(db);

const AMOUNT = 100_000; // 1000 ₴
const INVOICE = 'inv_test_0001';

let studentId: number;
let teacherId: number;
let paymentId: number;

async function reset(): Promise<void> {
  await db.deleteFrom('payments').execute();
  await db.deleteFrom('transactions').execute();
  await db.deleteFrom('slots').execute();
  await db.deleteFrom('students').execute();
  await db.deleteFrom('teachers').execute();

  const teacherRow = await db.insertInto('teachers').values({
    name: 'Викладач', email: 't@test.local', password_hash: 'x',
    timezone: 'Europe/Kyiv', default_price_minor: 50_000,
  }).returning('id').executeTakeFirstOrThrow();
  teacherId = teacherRow.id;

  const student = await db.insertInto('students').values({
    teacher_id: teacherId, name: 'Студент', email: 's@test.local',
    password_hash: 'x', timezone: 'Europe/Kyiv',
  }).returning('id').executeTakeFirstOrThrow();
  studentId = student.id;

  const payment = await payments.create({
    studentId, teacherId, provider: 'monobank', amountMinor: AMOUNT,
  });
  await payments.attachInvoice(payment.id, INVOICE, 'https://pay.test/invoice');
  paymentId = payment.id;
}

/**
 * Те, що робить обробник вебхука: проводка в журналі й позначка платежу в
 * одній транзакції. Якщо позначити не вдалось — платіж уже оплачено кимось
 * іншим, і вся транзакція відкочується разом із проводкою.
 */
async function handleWebhook(): Promise<boolean> {
  try {
    return await db.transaction().execute(async (tx) => {
      const t = await transactions.add(
        { studentId, amountMinor: AMOUNT, kind: 'topup', comment: `оплата ${INVOICE}` },
        tx,
      );
      // саме tx, а не db: запрос повз транзакцію взяв би ще одне зʼєднання з
      // пулу, тримаючи своє, і паралельні доставки заблокували б одна одну
      await tx.updateTable('students')
        .set((eb) => ({ balance_minor: eb('balance_minor', '+', AMOUNT) }))
        .where('id', '=', studentId)
        .execute();

      const claimed = await payments.markPaid(
        { provider: 'monobank', providerPaymentId: INVOICE, transactionId: t.id, raw: { ok: true } },
        tx,
      );
      if (!claimed) throw new Error('duplicate');
      return true;
    });
  } catch {
    return false;
  }
}

beforeEach(reset);
afterAll(async () => { await db.destroy(); });

describe('повторна доставка вебхука', () => {
  it('8 паралельних доставок: кошти зараховуються РІВНО один раз', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, handleWebhook));

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await transactions.sum(studentId)).toBe(AMOUNT);

    const row = await payments.byId(paymentId);
    expect(row?.status).toBe('paid');
    expect(row?.transaction_id).not.toBeNull();
    // мерчант фіксується в платежі: саме його ключем перевіряється вебхук
    expect(row?.teacher_id).toBe(teacherId);
  });

  it('послідовна повторна доставка теж не проходить двічі', async () => {
    expect(await handleWebhook()).toBe(true);
    expect(await handleWebhook()).toBe(false);
    expect(await transactions.sum(studentId)).toBe(AMOUNT);
  });

  it('невдалий платіж не позначає оплаченим і не чіпає журнал', async () => {
    await payments.markStatus({
      provider: 'monobank', providerPaymentId: INVOICE, status: 'failed', raw: { r: 'no funds' },
    });

    const row = await payments.byId(paymentId);
    expect(row?.status).toBe('failed');
    expect(await transactions.sum(studentId)).toBe(0);
  });

  it('оплачений платіж не відкочується пізнім вебхуком про невдачу', async () => {
    await handleWebhook();
    await payments.markStatus({
      provider: 'monobank', providerPaymentId: INVOICE, status: 'failed', raw: {},
    });

    expect((await payments.byId(paymentId))?.status).toBe('paid');
  });
});

describe('обмеження бази', () => {
  it('оплачений платіж без проводки в журналі неможливий', async () => {
    await expect(
      sql`update payments set status = 'paid' where id = ${paymentId}`.execute(db),
    ).rejects.toThrow(/payments_paid_has_transaction/);
  });

  it('два платежі з одним invoiceId неможливі', async () => {
    const second = await payments.create({
      studentId, teacherId, provider: 'monobank', amountMinor: AMOUNT,
    });
    await expect(payments.attachInvoice(second.id, INVOICE, 'https://pay.test/dup'))
      .rejects.toThrow(/payments_provider_ref/);
  });
});

describe('протермінування', () => {
  it('зависле в pending стає expired, оплачене не чіпається', async () => {
    await sql`update payments set created_at = now() - interval '2 hours'`.execute(db);

    const expired = await payments.expirePending(60);
    expect(expired).toBe(1);
    expect((await payments.byId(paymentId))?.status).toBe('expired');

    await reset();
    await handleWebhook();
    await sql`update payments set created_at = now() - interval '2 hours'`.execute(db);
    expect(await payments.expirePending(60)).toBe(0);
  });
});
