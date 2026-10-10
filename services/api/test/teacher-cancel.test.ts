/**
 * Скасування заняття викладачем: година звільняється, оплата повертається.
 *
 * Тест інтеграційний навмисно. Головне тут не арифметика — її перевіряє ядро,
 * — а те, що звільнення слота й повернення коштів неподільні й відбуваються
 * РІВНО ОДИН раз, навіть якщо кнопку натиснули кілька разів підряд. Жодне
 * з двох не можна показати без справжнього PostgreSQL.
 *
 * Потрібна піднята локальна база: docker compose -f compose.dev.yml up -d
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/database.module.js';
import { ChargeAdapter } from '../src/billing/charge.adapter.js';
import { StudentsRepository } from '../src/billing/students.repository.js';
import { TransactionsRepository } from '../src/billing/transactions.repository.js';
import { AvailabilityRepository } from '../src/scheduling/availability.repository.js';
import { SchedulingService } from '../src/scheduling/scheduling.service.js';
import { SlotsRepository } from '../src/scheduling/slots.repository.js';
import { TeachersRepository } from '../src/scheduling/teachers.repository.js';
import type { SlotStatusColumn } from '../src/db/schema.js';

const db = createDatabase();
const slots = new SlotsRepository(db);
const students = new StudentsRepository(db);
const transactions = new TransactionsRepository(db);
const teachers = new TeachersRepository(db);
const availability = new AvailabilityRepository(db);
const charge = new ChargeAdapter(students, transactions);
const scheduling = new SchedulingService(db, slots, teachers, availability, charge);

const NOW = new Date('2027-07-01T09:00:00Z');
const START = new Date('2027-07-10T13:00:00Z');
const PRICE = 50_000;
const TOPUP = 200_000;

let teacherId: number;
let otherTeacherId: number;
let studentId: number;

async function reset(): Promise<void> {
  await db.deleteFrom('payments').execute();
  await db.deleteFrom('transactions').execute();
  await db.deleteFrom('slots').execute();
  await db.deleteFrom('students').execute();
  await db.deleteFrom('teachers').execute();

  const [t, other] = await db
    .insertInto('teachers')
    .values([
      {
        name: 'Викладач', email: 't@test.local', password_hash: 'x',
        timezone: 'Europe/Kyiv', default_price_minor: PRICE,
      },
      {
        name: 'Інший викладач', email: 't2@test.local', password_hash: 'x',
        timezone: 'Europe/Kyiv', default_price_minor: PRICE,
      },
    ])
    .returning('id')
    .execute();
  teacherId = t!.id;
  otherTeacherId = other!.id;

  const s = await db.insertInto('students').values({
    teacher_id: teacherId, name: 'Студент', email: 's@test.local',
    password_hash: 'x', timezone: 'Europe/Kyiv',
  }).returning('id').executeTakeFirstOrThrow();
  studentId = s.id;

  // Поповнення вноситься як проводка плюс зсув кешу — так само, як це робить
  // білінг: інакше звірка балансу з журналом не мала б сенсу.
  await transactions.add({ studentId, amountMinor: TOPUP, kind: 'topup' });
  await students.shiftBalance(studentId, TOPUP);
}

/** Заняття потрібного статусу. `booked` створюється разом зі списанням. */
async function makeSlot(
  status: SlotStatusColumn,
  startAt: Date = START,
  owner: number = teacherId,
): Promise<number> {
  const slot = await db.insertInto('slots').values({
    teacher_id: owner,
    start_at: startAt,
    end_at: new Date(startAt.getTime() + 3_600_000),
    price_minor: PRICE,
    status,
    student_id: status === 'free' ? null : studentId,
    hold_expires_at: status === 'pre_booked' ? new Date(startAt.getTime() - 86_400_000) : null,
    paid_at: status === 'booked' || status === 'done' ? NOW : null,
  }).returning('id').executeTakeFirstOrThrow();

  if (status === 'booked' || status === 'done') {
    await charge.chargeForLesson(db, studentId, slot.id, PRICE);
  }

  return slot.id;
}

const balanceOf = async () => (await students.byId(studentId))?.balance_minor;

beforeEach(reset);
afterAll(async () => { await db.destroy(); });

describe('оплачене заняття', () => {
  it('звільняється, а кошти повертаються на баланс', async () => {
    const slotId = await makeSlot('booked');
    expect(await balanceOf()).toBe(TOPUP - PRICE);

    const result = await scheduling.cancelByTeacher(slotId, teacherId, NOW);

    expect(result).toMatchObject({
      status: 'free',
      refunded: true,
      refundedMinor: PRICE,
      studentId,
    });

    const slot = await slots.byId(slotId);
    expect(slot?.status).toBe('free');
    expect(slot?.student_id).toBeNull();
    expect(slot?.paid_at).toBeNull();

    // Кеш і журнал мусять зійтись в одному значенні — повернення пішло обома
    // шляхами, а не лише в один із них.
    expect(await balanceOf()).toBe(TOPUP);
    expect(await transactions.sum(studentId)).toBe(TOPUP);
  });

  it('правило cancelHours на викладача не діє: за годину до початку те саме', async () => {
    const soon = new Date(NOW.getTime() + 3_600_000);
    const slotId = await makeSlot('booked', soon);

    const result = await scheduling.cancelByTeacher(slotId, teacherId, NOW);

    expect(result.status).toBe('free');       // не cancelled_late
    expect(result.refunded).toBe(true);
    expect(await balanceOf()).toBe(TOPUP);
  });

  it('повторне скасування не повертає кошти вдруге', async () => {
    const slotId = await makeSlot('booked');
    await scheduling.cancelByTeacher(slotId, teacherId, NOW);

    await expect(scheduling.cancelByTeacher(slotId, teacherId, NOW)).rejects.toThrow();
    expect(await balanceOf()).toBe(TOPUP);
  });

  it('десять одночасних скасувань повертають кошти РІВНО один раз', async () => {
    const slotId = await makeSlot('booked');

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => scheduling.cancelByTeacher(slotId, teacherId, NOW)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balanceOf()).toBe(TOPUP);
    expect(await transactions.sum(studentId)).toBe(TOPUP);
  });
});

describe('неоплачене закріплення', () => {
  it('звільняється, але повертати нічого', async () => {
    const slotId = await makeSlot('pre_booked');

    const result = await scheduling.cancelByTeacher(slotId, teacherId, NOW);

    expect(result.refunded).toBe(false);
    expect(result.refundedMinor).toBe(0);
    expect((await slots.byId(slotId))?.status).toBe('free');
    // Баланс не рухався: за це заняття ніхто не платив.
    expect(await balanceOf()).toBe(TOPUP);
    expect(await transactions.sum(studentId)).toBe(TOPUP);
  });
});

describe('скасувати не можна', () => {
  it('вільний слот', async () => {
    const slotId = await makeSlot('free');
    await expect(scheduling.cancelByTeacher(slotId, teacherId, NOW)).rejects.toThrow();
  });

  it('проведене заняття', async () => {
    const slotId = await makeSlot('done', new Date(NOW.getTime() - 86_400_000));
    await expect(scheduling.cancelByTeacher(slotId, teacherId, NOW)).rejects.toThrow();
    expect(await balanceOf()).toBe(TOPUP - PRICE);
  });

  it('заняття, яке вже почалось', async () => {
    const slotId = await makeSlot('booked', new Date(NOW.getTime() - 60_000));
    await expect(scheduling.cancelByTeacher(slotId, teacherId, NOW)).rejects.toThrow();
    expect(await balanceOf()).toBe(TOPUP - PRICE);
  });

  it('заняття чужого викладача — його навіть не видно', async () => {
    const slotId = await makeSlot('booked', START, otherTeacherId);
    await expect(scheduling.cancelByTeacher(slotId, teacherId, NOW)).rejects.toThrow(
      /не знайдено/,
    );
    expect((await slots.byId(slotId))?.status).toBe('booked');
  });
});
