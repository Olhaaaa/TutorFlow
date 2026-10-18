/**
 * Перенесення заняття.
 *
 * Правило перевіряє ядро; тут перевіряється те, що існує лише в базі:
 * неподільність двох змін слота плюс двох проводок, і те, що між ними місце
 * не можна забрати.
 *
 * Потрібна піднята локальна база: docker compose -f compose.dev.yml up -d
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/database.module.js';
import { StudentDirectoryAdapter } from '../src/billing/student-directory.adapter.js';
import { NoopOutboxFlush } from '../src/outbox/flush.js';
import { ChargeAdapter } from '../src/billing/charge.adapter.js';
import { StudentsRepository } from '../src/billing/students.repository.js';
import { TransactionsRepository } from '../src/billing/transactions.repository.js';
import { EventBus } from '../src/events/event-bus.js';
import { AvailabilityRepository } from '../src/scheduling/availability.repository.js';
import { ExternalBusyRepository } from '../src/scheduling/external-busy.repository.js';
import { SchedulingService } from '../src/scheduling/scheduling.service.js';
import { SlotsRepository } from '../src/scheduling/slots.repository.js';
import { TeachersRepository } from '../src/scheduling/teachers.repository.js';

const db = createDatabase();
const slots = new SlotsRepository(db);
const students = new StudentsRepository(db);
const transactions = new TransactionsRepository(db);
const teachers = new TeachersRepository(db);
const externalBusy = new ExternalBusyRepository(db);
const charge = new ChargeAdapter(students, transactions);
const scheduling = new SchedulingService(
  db, slots, teachers, new AvailabilityRepository(db), charge, new EventBus(), externalBusy,
  new StudentDirectoryAdapter(students),
  new NoopOutboxFlush(),
);

const NOW = new Date('2027-07-01T09:00:00Z');
const PRICE = 50_000;
const TOPUP = 200_000;
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

let teacherId: number;
let studentId: number;
let student: { id: number; teacherId: number };

async function reset(): Promise<void> {
  await db.deleteFrom('external_busy').execute();
  await db.deleteFrom('notifications').execute();
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
  student = { id: studentId, teacherId };

  await transactions.add({ studentId, amountMinor: TOPUP, kind: 'topup' });
  await students.shiftBalance(studentId, TOPUP);
}

/** Оплачене заняття: разом зі списанням, як це робить бронювання. */
async function booked(startAt: Date): Promise<number> {
  const row = await db.insertInto('slots').values({
    teacher_id: teacherId, start_at: startAt, end_at: new Date(startAt.getTime() + 3_600_000),
    price_minor: PRICE, status: 'booked', student_id: studentId, paid_at: NOW,
  }).returning('id').executeTakeFirstOrThrow();
  await charge.chargeForLesson(db, studentId, row.id, PRICE);
  return row.id;
}

async function free(startAt: Date): Promise<number> {
  const row = await db.insertInto('slots').values({
    teacher_id: teacherId, start_at: startAt, end_at: new Date(startAt.getTime() + 3_600_000),
    price_minor: PRICE, status: 'free',
  }).returning('id').executeTakeFirstOrThrow();
  return row.id;
}

const balance = async () => (await students.byId(studentId))?.balance_minor;
/**
 * Проводки в порядку ВСТАВКИ.
 *
 * Сортувати за `created_at` тут не можна: обидві проводки переносу лежать в
 * одній транзакції, а `now()` у PostgreSQL однаковий на всю транзакцію — отже
 * час у них збігається до мікросекунди й порядку не задає. Порядок задає `id`.
 */
const kinds = async () =>
  (await transactions.recent(studentId, 20))
    .sort((a, b) => a.id - b.id)
    .map((t) => t.kind);

beforeEach(reset);
afterAll(async () => { await db.destroy(); });

describe('оплачене заняття', () => {
  it('переїжджає разом з оплатою: баланс не змінюється', async () => {
    const from = await booked(hours(48));
    const to = await free(hours(72));
    expect(await balance()).toBe(TOPUP - PRICE);

    const r = await scheduling.reschedule(from, to, student, NOW);

    expect(r).toMatchObject({ from, to, status: 'booked', paid: true });
    expect(await balance()).toBe(TOPUP - PRICE);
    // журнал правдивий: повернення за старий слот і списання за новий
    expect(await kinds()).toEqual(['topup', 'lesson_charge', 'refund', 'lesson_charge']);
  });

  it('старий слот вільний, новий оплачений', async () => {
    const from = await booked(hours(48));
    const to = await free(hours(72));

    await scheduling.reschedule(from, to, student, NOW);

    const [oldSlot, newSlot] = await Promise.all([slots.byId(from), slots.byId(to)]);
    expect(oldSlot).toMatchObject({ status: 'free', student_id: null, paid_at: null });
    expect(newSlot).toMatchObject({ status: 'booked', student_id: studentId });
    expect(newSlot?.paid_at).not.toBeNull();
  });

  it('кешований баланс сходиться з журналом після переносу', async () => {
    const from = await booked(hours(48));
    await scheduling.reschedule(from, await free(hours(72)), student, NOW);

    expect(await balance()).toBe(await transactions.sum(studentId));
  });
});

describe('неоплачене закріплення', () => {
  it('переноситься, а дедлайн оплати рахується від НОВОГО початку', async () => {
    const row = await db.insertInto('slots').values({
      teacher_id: teacherId, start_at: hours(48), end_at: hours(49),
      price_minor: PRICE, status: 'pre_booked', student_id: studentId,
      hold_expires_at: hours(24),
    }).returning('id').executeTakeFirstOrThrow();
    const to = await free(hours(96));

    const r = await scheduling.reschedule(row.id, to, student, NOW);

    expect(r).toMatchObject({ status: 'pre_booked', paid: false });
    // payment_deadline_hours за замовчуванням 24: 96 − 24 = 72
    expect(r.payBy).toBe(hours(72).toISOString());
    // грошей не чіпали
    expect(await kinds()).toEqual(['topup']);
  });
});

describe('відмови', () => {
  it('надто пізно для оплаченого заняття — 400, і нічого не змінилось', async () => {
    const from = await booked(hours(2));
    const to = await free(hours(72));

    await expect(scheduling.reschedule(from, to, student, NOW)).rejects.toThrow(/не пізніше/);

    expect((await slots.byId(from))?.status).toBe('booked');
    expect((await slots.byId(to))?.status).toBe('free');
    expect(await balance()).toBe(TOPUP - PRICE);
  });

  it('у зайнятий слот — 409', async () => {
    const from = await booked(hours(48));
    const other = await db.insertInto('students').values({
      teacher_id: teacherId, name: 'Інший', email: 's2@test.local',
      password_hash: 'x', timezone: 'Europe/Kyiv',
    }).returning('id').executeTakeFirstOrThrow();
    const taken = await db.insertInto('slots').values({
      teacher_id: teacherId, start_at: hours(72), end_at: hours(73),
      price_minor: PRICE, status: 'booked', student_id: other.id, paid_at: NOW,
    }).returning('id').executeTakeFirstOrThrow();

    await expect(scheduling.reschedule(from, taken.id, student, NOW)).rejects.toThrow(/зайнятий/);
  });

  it('у годину, коли викладач зайнятий поза розкладом, — теж 409', async () => {
    const from = await booked(hours(48));
    const to = await free(hours(72));
    await externalBusy.upsert(teacherId, {
      startAt: hours(72), endAt: hours(73), title: 'Лікар',
    });

    await expect(scheduling.reschedule(from, to, student, NOW)).rejects.toThrow(/зайнятий/);
    expect((await slots.byId(from))?.status).toBe('booked');
  });

  it('чуже заняття перенести не можна', async () => {
    const other = await db.insertInto('students').values({
      teacher_id: teacherId, name: 'Інший', email: 's2@test.local',
      password_hash: 'x', timezone: 'Europe/Kyiv',
    }).returning('id').executeTakeFirstOrThrow();
    const theirs = await db.insertInto('slots').values({
      teacher_id: teacherId, start_at: hours(48), end_at: hours(49),
      price_minor: PRICE, status: 'booked', student_id: other.id, paid_at: NOW,
    }).returning('id').executeTakeFirstOrThrow();

    await expect(scheduling.reschedule(theirs.id, await free(hours(72)), student, NOW))
      .rejects.toThrow(/не ваше/);
  });

  it('на той самий слот — 400', async () => {
    const from = await booked(hours(48));
    await expect(scheduling.reschedule(from, from, student, NOW))
      .rejects.toThrow(/той самий/);
  });
});

describe('одночасність', () => {
  it('десять одночасних переносів на один слот: виграє РІВНО один', async () => {
    const from = await booked(hours(48));
    const to = await free(hours(72));

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => scheduling.reschedule(from, to, student, NOW)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    // гроші не подвоїлись: рівно одна пара refund + charge
    expect(await balance()).toBe(TOPUP - PRICE);
    expect(await transactions.sum(studentId)).toBe(TOPUP - PRICE);
  });

  it('два студенти на один вільний слот: другий отримує відмову', async () => {
    const mine = await booked(hours(48));
    const to = await free(hours(72));

    const other = await db.insertInto('students').values({
      teacher_id: teacherId, name: 'Інший', email: 's2@test.local',
      password_hash: 'x', timezone: 'Europe/Kyiv',
    }).returning('id').executeTakeFirstOrThrow();
    const theirs = await db.insertInto('slots').values({
      teacher_id: teacherId, start_at: hours(50), end_at: hours(51),
      price_minor: PRICE, status: 'pre_booked', student_id: other.id,
      hold_expires_at: hours(26),
    }).returning('id').executeTakeFirstOrThrow();

    const results = await Promise.allSettled([
      scheduling.reschedule(mine, to, student, NOW),
      scheduling.reschedule(theirs.id, to, { id: other.id, teacherId }, NOW),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const target = await slots.byId(to);
    expect(target?.status === 'booked' || target?.status === 'pre_booked').toBe(true);
  });
});
