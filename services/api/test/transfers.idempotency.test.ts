/**
 * Рух коштів, який прийшов ІЗВНІ: з сусіднього сервіса, по мережі, можливо
 * вдруге.
 *
 * Це головний новий інваріант лабораторної 3. Доставка at-least-once означає,
 * що те саме списання прийде двічі щоразу, коли наше підтвердження не дійшло.
 * Застосувати його двічі не можна — це гроші, і помилка тут не стирається
 * перезавантаженням сторінки.
 *
 * Тест інтеграційний із тієї самої причини, що й решта грошових: захист
 * стоїть у БАЗІ, унікальним індексом по ключу операції, а не перевіркою в
 * коді. Двом одночасним спробам перевірка в коді не допомогла б — обидві
 * пройшли б її до першої вставки, і саме цей випадок тут і перевіряється.
 *
 * Потрібна піднята локальна база: docker compose -f compose.dev.yml up -d
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/database.module.js';
import { StudentsRepository } from '../src/billing/students.repository.js';
import { TransactionsRepository } from '../src/billing/transactions.repository.js';
import { InsufficientFundsError, TransfersService } from '../src/billing/transfers.service.js';

const db = createDatabase();
const students = new StudentsRepository(db);
const transactions = new TransactionsRepository(db);
const transfers = new TransfersService(db, students, transactions);

const PRICE = 50_000;
let studentId: number;
let slotId: number;

async function reset(): Promise<void> {
  await db.deleteFrom('payments').execute();
  await db.deleteFrom('transactions').execute();
  await db.deleteFrom('slots').execute();
  await db.deleteFrom('students').execute();
  await db.deleteFrom('teachers').execute();

  const t = await db.insertInto('teachers').values({
    name: 'Викладач', email: 't@test.local', password_hash: 'x',
    timezone: 'Europe/Kyiv', default_price_minor: PRICE,
  }).returning('id').executeTakeFirstOrThrow();

  const s = await db.insertInto('students').values({
    teacher_id: t.id, name: 'Студент', email: 's@test.local',
    password_hash: 'x', timezone: 'Europe/Kyiv', balance_minor: 100_000,
  }).returning('id').executeTakeFirstOrThrow();
  studentId = s.id;

  const start = new Date('2027-07-10T13:00:00Z');
  const slot = await db.insertInto('slots').values({
    teacher_id: t.id, start_at: start, end_at: new Date(start.getTime() + 3_600_000),
    price_minor: PRICE, status: 'booked', student_id: studentId, paid_at: new Date(),
  }).returning('id').executeTakeFirstOrThrow();
  slotId = slot.id;
}

const balance = async (): Promise<number> =>
  (await students.byId(studentId))?.balance_minor ?? 0;

const charge = (opId: string) =>
  transfers.apply('lesson_charge', { opId, studentId, slotId, amountMinor: PRICE });

const refund = (opId: string) =>
  transfers.apply('refund', { opId, studentId, slotId, amountMinor: PRICE });

beforeEach(reset);
afterAll(async () => { await db.destroy(); });

describe('списання, яке прийшло по мережі', () => {
  it('застосовується раз і рухає баланс', async () => {
    const res = await charge('op-1');

    expect(res.applied).toBe(true);
    expect(res.balanceMinor).toBe(50_000);
    expect(await balance()).toBe(50_000);
  });

  /**
   * Повтор — не помилка: сусід мав право не отримати нашого підтвердження.
   * Відповідь на нього така сама, лише `applied: false`, щоб у лозі було
   * видно, що гроші НЕ рухались удруге.
   */
  it('повторна доставка не рухає баланс удруге', async () => {
    await charge('op-1');
    const again = await charge('op-1');

    expect(again.applied).toBe(false);
    expect(again.balanceMinor).toBe(50_000);
    expect(await balance()).toBe(50_000);

    const journal = await db.selectFrom('transactions').selectAll()
      .where('op_id', '=', 'op-1').execute();
    expect(journal).toHaveLength(1);
  });

  /**
   * Те, через що ключем не може бути слот. Студент бронює й скасовує ту саму
   * годину по колу: друге повернення за слот 42 — законна операція, а не
   * повтор. Ключ ідентифікує ОПЕРАЦІЮ, а операція — подія в часі.
   */
  it('дві різні операції над тим самим слотом застосовуються обидві', async () => {
    await charge('op-charge-1');
    await refund('op-refund-1');
    await charge('op-charge-2');
    await refund('op-refund-2');

    expect(await balance()).toBe(100_000);
    const journal = await db.selectFrom('transactions')
      .select(['kind', 'amount_minor']).orderBy('id').execute();
    expect(journal).toHaveLength(4);
  });

  /**
   * ДВІ ОДНОЧАСНІ доставки того самого завдання. Перевірка «чи вже є такий
   * ключ» пропустить обидві — між нею й вставкою є проміжок. Не пропустить
   * унікальний індекс, і друга спроба мусить відповісти як на звичайний
   * повтор, а не впасти.
   */
  it('дві одночасні доставки одного ключа: гроші рухаються РІВНО раз', async () => {
    const results = await Promise.all([charge('op-same'), charge('op-same')]);

    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(results.filter((r) => !r.applied)).toHaveLength(1);
    expect(await balance()).toBe(50_000);
  });

  it('десять одночасних доставок одного ключа дають одну проводку', async () => {
    await Promise.all(
      Array.from({ length: 10 }, () => charge('op-storm').catch(() => null)),
    );

    const journal = await db.selectFrom('transactions').selectAll()
      .where('op_id', '=', 'op-storm').execute();
    expect(journal).toHaveLength(1);
    expect(await balance()).toBe(50_000);
  });
});

describe('коштів не вистачає', () => {
  /**
   * Відмова — НЕ збій. Між перевіркою доступності на боці розкладу й цим
   * запросом баланс могла зрушити паралельна операція, і саме тому відмова
   * має власний тип: відповідь на неї — компенсація в розкладі, а не повтор.
   */
  it('списання, яке заганяє баланс у мінус, відхиляється', async () => {
    await charge('op-a');   // 100 000 → 50 000
    await charge('op-b');   // 50 000 → 0

    await expect(charge('op-c')).rejects.toThrow(InsufficientFundsError);
    expect(await balance()).toBe(0);
  });

  it('відмова не лишає в журналі ні проводки, ні ключа', async () => {
    await charge('op-a');
    await charge('op-b');
    await charge('op-c').catch(() => null);

    const journal = await db.selectFrom('transactions').selectAll()
      .where('op_id', '=', 'op-c').execute();
    expect(journal).toHaveLength(0);

    // Ключ не згорів: коли кошти зʼявляться, те саме завдання можна застосувати.
    const after = await refund('op-refund');
    expect(after.applied).toBe(true);
    const retry = await charge('op-c');
    expect(retry.applied).toBe(true);
  });

  /** Повернення коштів балансом не обмежене: ми повертаємо вже списане. */
  it('повернення проходить навіть при нульовому балансі', async () => {
    await charge('op-a');
    await charge('op-b');
    expect(await balance()).toBe(0);

    const res = await refund('op-back');
    expect(res.applied).toBe(true);
    expect(await balance()).toBe(50_000);
  });
});
