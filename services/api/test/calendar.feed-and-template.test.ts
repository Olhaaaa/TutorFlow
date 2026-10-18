/**
 * Дві речі, які живуть лише в базі: прибирання години з тижневого шаблону й
 * стрічка `.ics` студента.
 *
 * Чому інтеграційний. Прибирання години тримається на тому, що день тижня й
 * час майбутніх слотів рахуються в зоні ВИКЛАДАЧА тим самим виразом, що й
 * генерація, — у коді це виглядало б правильно за будь-якої реалізації, а в
 * базі воно або влучає в ту саму годину, або в сусідню. Стрічка студента
 * тримається на тому, що токен шукається по колонці `students`, і жодне чуже
 * заняття туди не потрапляє.
 *
 * Потрібна піднята локальна база: docker compose -f compose.dev.yml up -d
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/database.module.js';
import { NoopOutboxFlush } from '../src/outbox/flush.js';
import { ChargeAdapter } from '../src/billing/charge.adapter.js';
import { StudentDirectoryAdapter } from '../src/billing/student-directory.adapter.js';
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
const availability = new AvailabilityRepository(db);
const scheduling = new SchedulingService(
  db, slots, teachers, availability,
  new ChargeAdapter(students, transactions),
  new EventBus(),
  new ExternalBusyRepository(db),
  new StudentDirectoryAdapter(students),
  new NoopOutboxFlush(),
);

const PRICE = 50_000;
/** Субота, 13:00 UTC — 16:00 у Києві влітку. Саме о цій годині стоїть шаблон. */
const START = new Date('2027-07-10T13:00:00Z');
const END = new Date('2027-07-10T14:00:00Z');
const NEXT_WEEK = new Date('2027-07-17T13:00:00Z');
/** Інша година того ж дня: вона мусить пережити прибирання сусідньої. */
const OTHER_HOUR = new Date('2027-07-10T15:00:00Z');

let teacherId: number;
let otherTeacherId: number;
let studentId: number;
let otherStudentId: number;

async function reset(): Promise<void> {
  await db.deleteFrom('external_busy').execute();
  await db.deleteFrom('notifications').execute();
  await db.deleteFrom('payments').execute();
  await db.deleteFrom('transactions').execute();
  await db.deleteFrom('slots').execute();
  await db.deleteFrom('availability_rules').execute();
  await db.deleteFrom('students').execute();
  await db.deleteFrom('teachers').execute();

  const [t, other] = await db.insertInto('teachers').values([
    {
      name: 'Марія', email: 't@test.local', password_hash: 'x',
      timezone: 'Europe/Kyiv', default_price_minor: PRICE,
    },
    {
      name: 'Інший', email: 't2@test.local', password_hash: 'x',
      timezone: 'Europe/Kyiv', default_price_minor: PRICE,
    },
  ]).returning('id').execute();
  teacherId = t!.id;
  otherTeacherId = other!.id;

  const [s, o] = await db.insertInto('students').values([
    {
      teacher_id: teacherId, name: 'Віра', email: 's@test.local',
      password_hash: 'x', timezone: 'Europe/Kyiv',
    },
    {
      teacher_id: teacherId, name: 'Сусід', email: 's2@test.local',
      password_hash: 'x', timezone: 'Europe/Kyiv',
    },
  ]).returning('id').execute();
  studentId = s!.id;
  otherStudentId = o!.id;
}

/** Година 16:00 суботи в шаблоні викладача. */
async function rule(owner = teacherId): Promise<number> {
  const row = await availability.upsertRule(owner, {
    weekday: 6, startTime: '16:00', durationMin: 60, priceMinor: PRICE,
  });
  return row.id;
}

async function slot(
  start: Date,
  status: 'free' | 'booked' = 'free',
  owner = teacherId,
  student: number | null = null,
): Promise<number> {
  const row = await db.insertInto('slots').values({
    teacher_id: owner,
    start_at: start,
    end_at: new Date(start.getTime() + 3_600_000),
    price_minor: PRICE,
    status,
    student_id: student,
    // `slots_paid_matches`: оплачене заняття без позначки оплати база не прийме.
    paid_at: status === 'booked' ? start : null,
  }).returning('id').executeTakeFirstOrThrow();
  return row.id;
}

const liveIds = async () =>
  (await db.selectFrom('slots').select('id').orderBy('id').execute()).map((r) => r.id);

beforeEach(reset);
afterAll(async () => { await db.destroy(); });

describe('прибирання години з шаблону', () => {
  it('вимикає правило й прибирає майбутні вільні слоти цієї години', async () => {
    const id = await rule();
    await slot(START);
    await slot(NEXT_WEEK);

    const res = await scheduling.removeAvailability(teacherId, id);

    expect(res.slotsRemoved).toBe(2);
    expect(await liveIds()).toEqual([]);
    expect(await availability.listRules(teacherId)).toEqual([]);
  });

  it('зайняте заняття лишається — його скасовує людина, а не видалення години', async () => {
    const id = await rule();
    const booked = await slot(START, 'booked', teacherId, studentId);
    await slot(NEXT_WEEK);

    const res = await scheduling.removeAvailability(teacherId, id);

    expect(res.slotsRemoved).toBe(1);
    expect(await liveIds()).toEqual([booked]);
  });

  it('сусідня година того ж дня не зачіпається', async () => {
    const id = await rule();
    await slot(START);
    const keep = await slot(OTHER_HOUR);

    await scheduling.removeAvailability(teacherId, id);

    expect(await liveIds()).toEqual([keep]);
  });

  it('чуже правило прибрати не можна', async () => {
    const id = await rule(otherTeacherId);
    await expect(scheduling.removeAvailability(teacherId, id)).rejects.toThrow();
    expect(await availability.listRules(otherTeacherId)).toHaveLength(1);
  });

  it('повторне прибирання тієї самої години — 404, а не мовчазний успіх', async () => {
    const id = await rule();
    await scheduling.removeAvailability(teacherId, id);
    await expect(scheduling.removeAvailability(teacherId, id)).rejects.toThrow();
  });

  it('та сама година, додана заново, вмикає правило назад без дубліката', async () => {
    const id = await rule();
    await scheduling.removeAvailability(teacherId, id);

    await availability.upsertRule(teacherId, {
      weekday: 6, startTime: '16:00', durationMin: 90, priceMinor: PRICE * 2,
    });

    const rules = await availability.listRules(teacherId);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.duration_min).toBe(90);
  });
});

describe('стрічка .ics студента', () => {
  /** Токен видається один раз: адресу вже вставлено в чужу програму. */
  it('повторний запит віддає ту саму адресу', async () => {
    const first = await scheduling.studentCalendarLink(studentId);
    const second = await scheduling.studentCalendarLink(studentId);

    expect(first.path).toBe(second.path);
    expect(first.path).toMatch(/^\/api\/calendar\/student\/[\w-]{20,}\.ics$/);
  });

  it('у стрічці лише заняття цього студента', async () => {
    await slot(START, 'booked', teacherId, studentId);
    await slot(NEXT_WEEK, 'booked', teacherId, otherStudentId);
    await slot(OTHER_HOUR); // вільний, нічий

    const { path } = await scheduling.studentCalendarLink(studentId);
    const token = path.split('/').pop()!.replace('.ics', '');
    const feed = await scheduling.studentCalendarFeed(token, START);

    expect(feed).toContain('Заняття: Марія');
    expect(feed.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it('відкликана адреса перестає працювати', async () => {
    const { path } = await scheduling.studentCalendarLink(studentId);
    const token = path.split('/').pop()!.replace('.ics', '');

    await scheduling.revokeStudentCalendarLink(studentId);

    await expect(scheduling.studentCalendarFeed(token)).rejects.toThrow();
  });

  it('після відкликання видається НОВА адреса', async () => {
    const before = await scheduling.studentCalendarLink(studentId);
    await scheduling.revokeStudentCalendarLink(studentId);
    const after = await scheduling.studentCalendarLink(studentId);

    expect(after.path).not.toBe(before.path);
  });
});
