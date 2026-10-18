/**
 * КОМПЕНСАЦІЯ: що робити із заняттям, за яке не вдалось списати кошти.
 *
 * Стан «слот оплачений, а гроші не списані» у моноліті неможливий — там це
 * одна транзакція. У мікросервісах він можливий рівно в одному випадку:
 * перевірка балансу пройшла, а між нею й списанням паралельна операція
 * забрала кошти. Відповідь на це — повернути заняття в `pre_booked`, тобто в
 * той самий стан, у який воно стало б одразу, якби про брак коштів було
 * відомо на початку. Студент не втрачає місця, він лишається з обовʼязком
 * заплатити.
 *
 * Тест інтеграційний, бо вся гарантія — в умові `status = 'booked'` усередині
 * UPDATE: саме вона робить компенсацію ідемпотентною й не дає зачепити
 * заняття, яке студент за цей час уже скасував.
 *
 * Потрібна піднята локальна база: docker compose -f compose.dev.yml up -d
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/database.module.js';
import { ChargeAdapter } from '../src/billing/charge.adapter.js';
import { StudentDirectoryAdapter } from '../src/billing/student-directory.adapter.js';
import { StudentsRepository } from '../src/billing/students.repository.js';
import { TransactionsRepository } from '../src/billing/transactions.repository.js';
import { EventBus } from '../src/events/event-bus.js';
import { NoopOutboxFlush } from '../src/outbox/flush.js';
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
const scheduling = new SchedulingService(
  db, slots, teachers, new AvailabilityRepository(db),
  new ChargeAdapter(students, transactions),
  new EventBus(),
  new ExternalBusyRepository(db),
  new StudentDirectoryAdapter(students),
  new NoopOutboxFlush(),
);

const PRICE = 50_000;
/** Той самий строк, що в сідері: від нього рахується дедлайн оплати. */
const DEADLINE_HOURS = 24;
const START = new Date('2027-07-10T13:00:00Z');

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
    payment_deadline_hours: DEADLINE_HOURS,
  }).returning('id').executeTakeFirstOrThrow();

  const s = await db.insertInto('students').values({
    teacher_id: t.id, name: 'Студент', email: 's@test.local',
    password_hash: 'x', timezone: 'Europe/Kyiv',
  }).returning('id').executeTakeFirstOrThrow();
  studentId = s.id;

  const slot = await db.insertInto('slots').values({
    teacher_id: t.id, start_at: START, end_at: new Date(START.getTime() + 3_600_000),
    price_minor: PRICE, status: 'booked', student_id: studentId, paid_at: new Date(),
  }).returning('id').executeTakeFirstOrThrow();
  slotId = slot.id;
}

const state = async () =>
  db.selectFrom('slots')
    .select(['status', 'student_id', 'paid_at', 'hold_expires_at'])
    .where('id', '=', slotId)
    .executeTakeFirstOrThrow();

beforeEach(reset);
afterAll(async () => { await db.destroy(); });

describe('невдале списання за заняття', () => {
  it('повертає заняття в неоплачене, зберігаючи місце за студентом', async () => {
    expect(await scheduling.revertFailedCharge(slotId)).toBe(true);

    const slot = await state();
    expect(slot.status).toBe('pre_booked');
    expect(slot.student_id).toBe(studentId);
    expect(slot.paid_at).toBeNull();
  });

  /** Строк оплати рахується від початку заняття, як і при звичайному бронюванні. */
  it('ставить строк оплати за добу до заняття', async () => {
    await scheduling.revertFailedCharge(slotId);

    const slot = await state();
    expect(slot.hold_expires_at).not.toBeNull();
    expect(new Date(slot.hold_expires_at!).toISOString())
      .toBe(new Date(START.getTime() - DEADLINE_HOURS * 3_600_000).toISOString());
  });

  it('повторна компенсація нічого не змінює', async () => {
    expect(await scheduling.revertFailedCharge(slotId)).toBe(true);
    expect(await scheduling.revertFailedCharge(slotId)).toBe(false);

    expect((await state()).status).toBe('pre_booked');
  });

  /**
   * Найважливіший випадок. Поки завдання на списання лежало в журналі,
   * студент міг скасувати заняття — і слот уже вільний. Компенсація НЕ має
   * права повернути його студентові: він нічого не винен за годину, від якої
   * відмовився.
   */
  it('не чіпає заняття, яке студент за цей час скасував', async () => {
    await db.updateTable('slots')
      .set({ status: 'free', student_id: null, paid_at: null })
      .where('id', '=', slotId)
      .execute();

    expect(await scheduling.revertFailedCharge(slotId)).toBe(false);

    const slot = await state();
    expect(slot.status).toBe('free');
    expect(slot.student_id).toBeNull();
  });

  it('не чіпає заняття, яке вже проведене', async () => {
    await db.updateTable('slots').set({ status: 'done' }).where('id', '=', slotId).execute();

    expect(await scheduling.revertFailedCharge(slotId)).toBe(false);
    expect((await state()).status).toBe('done');
  });

  it('слота немає — компенсувати нечого', async () => {
    expect(await scheduling.revertFailedCharge(slotId + 10_000)).toBe(false);
  });

  /**
   * Десять одночасних компенсацій — випадок, можливий через повторну доставку
   * того самого завдання двома дренажами. Умова в UPDATE мусить лишити рівно
   * одну зміну стану.
   */
  it('десять одночасних компенсацій змінюють стан РІВНО раз', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => scheduling.revertFailedCharge(slotId)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await state()).status).toBe('pre_booked');
  });
});
