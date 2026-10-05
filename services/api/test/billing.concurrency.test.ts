/**
 * Другий головний інваріант системи: за одне заняття не можна списати двічі,
 * а одночасні поповнення не мають губитись.
 *
 * Як і для розкладу, тест має сенс лише проти справжнього PostgreSQL: обидві
 * гарантії тримаються на тому, що база серіалізує зміни одного рядка.
 *
 * Потрібна піднята локальна база: docker compose -f compose.dev.yml up -d
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/database.module.js';
import { SlotsRepository } from '../src/scheduling/slots.repository.js';
import { StudentsRepository } from '../src/billing/students.repository.js';
import { TransactionsRepository } from '../src/billing/transactions.repository.js';
import { ChargeAdapter } from '../src/billing/charge.adapter.js';

const db = createDatabase();
const slots = new SlotsRepository(db);
const students = new StudentsRepository(db);
const transactions = new TransactionsRepository(db);
const charge = new ChargeAdapter(students, transactions);

const NOW = new Date('2027-07-01T09:00:00Z');
const START = new Date('2027-07-10T13:00:00Z');
const PRICE = 50_000;

let teacherId: number;
let studentId: number;
let slotId: number;

async function reset(): Promise<void> {
  // payments першими: вони посилаються на журнал, і база не дасть видалити
  // проводку, на яку є платіж
  await db.deleteFrom('payments').execute();
  await db.deleteFrom('transactions').execute();
  await db.deleteFrom('slots').execute();
  await db.deleteFrom('students').execute();
  await db.deleteFrom('teachers').execute();

  const t = await db.insertInto('teachers').values({
    name: 'Викладач', email: 't@test.local', password_hash: 'x',
    timezone: 'Europe/Kyiv', default_price_minor: PRICE,
  }).returning('id').executeTakeFirstOrThrow();
  teacherId = t.id;

  const s = await db.insertInto('students').values({
    teacher_id: teacherId, name: 'Студент', email: 's@test.local',
    password_hash: 'x', timezone: 'Europe/Kyiv',
  }).returning('id').executeTakeFirstOrThrow();
  studentId = s.id;

  const slot = await db.insertInto('slots').values({
    teacher_id: teacherId, start_at: START,
    end_at: new Date(START.getTime() + 3_600_000),
    price_minor: PRICE, status: 'pre_booked', student_id: studentId,
    hold_expires_at: new Date(START.getTime() - 86_400_000),
  }).returning('id').executeTakeFirstOrThrow();
  slotId = slot.id;
}

beforeEach(reset);
afterAll(async () => { await db.destroy(); });

describe('конвертація закріплення в оплачене заняття', () => {
  it('20 паралельних конвертацій одного слота: виграє РІВНО одна', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => slots.convertToBooked(slotId, NOW)),
    );

    expect(results.filter((r) => r !== null)).toHaveLength(1);

    const stored = await slots.byId(slotId);
    expect(stored?.status).toBe('booked');
    expect(stored?.paid_at).not.toBeNull();
    expect(stored?.hold_expires_at).toBeNull();
  });

  it('повторна конвертація вже оплаченого слота дає null', async () => {
    expect(await slots.convertToBooked(slotId, NOW)).not.toBeNull();
    expect(await slots.convertToBooked(slotId, NOW)).toBeNull();
  });
});

describe('баланс не губить одночасні зміни', () => {
  it('20 паралельних поповнень по 500 грн дають рівно 10000 грн', async () => {
    await Promise.all(
      Array.from({ length: 20 }, () => students.shiftBalance(studentId, PRICE)),
    );

    const student = await students.byId(studentId);
    expect(student?.balance_minor).toBe(20 * PRICE);
  });

  it('списання й повернення сходяться, кеш не розходиться з журналом', async () => {
    // поповнення завжди йде парою: запис у журнал плюс зсув кешу
    await transactions.add({ studentId, amountMinor: PRICE, kind: 'topup' });
    await students.shiftBalance(studentId, PRICE);

    await charge.chargeForLesson(db, studentId, slotId, PRICE);
    await charge.refundForLesson(db, studentId, slotId, PRICE);

    const student = await students.byId(studentId);
    expect(student?.balance_minor).toBe(PRICE);
    expect(await transactions.sum(studentId)).toBe(PRICE);
  });

  it('зсув кешу без запису в журнал ламає звірку — саме тому так не роблять', async () => {
    await students.shiftBalance(studentId, PRICE);

    const student = await students.byId(studentId);
    expect(student?.balance_minor).toBe(PRICE);
    expect(await transactions.sum(studentId)).toBe(0); // розбіжність видно
  });
});

describe('гроші й слот рухаються разом', () => {
  it('падіння всередині транзакції не лишає ні списання, ні зміни слота', async () => {
    await students.shiftBalance(studentId, PRICE);

    await expect(
      db.transaction().execute(async (tx) => {
        await slots.convertToBooked(slotId, NOW, tx);
        await charge.chargeForLesson(tx, studentId, slotId, PRICE);
        throw new Error('збій після списання');
      }),
    ).rejects.toThrow('збій після списання');

    const [slot, student] = await Promise.all([
      slots.byId(slotId),
      students.byId(studentId),
    ]);
    expect(slot?.status).toBe('pre_booked');       // слот не змінився
    expect(student?.balance_minor).toBe(PRICE);    // кошти не списані
    expect(await transactions.sum(studentId)).toBe(0);
  });

  it('кешований баланс збігається з сумою журналу', async () => {
    await db.transaction().execute(async (tx) => {
      await transactions.add({ studentId, amountMinor: 200_000, kind: 'topup' }, tx);
      await students.shiftBalance(studentId, 200_000, tx);
      await charge.chargeForLesson(tx, studentId, slotId, PRICE);
    });

    const student = await students.byId(studentId);
    expect(student?.balance_minor).toBe(150_000);
    expect(await transactions.sum(studentId)).toBe(150_000);
  });
});
