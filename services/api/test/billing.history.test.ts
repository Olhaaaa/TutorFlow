/**
 * Історія операцій: фільтр напрямку мусить доходити до ЗАПРОСУ.
 *
 * Журнал віддається вікном — останні двадцять операцій. Списань у ньому на
 * порядок більше, ніж поповнень: заняття проходять щотижня, а платять раз на
 * місяць. У студента, який ходить давно, вікно повністю забите заняттями, і
 * поповнення в кабінеті не видно взагалі — саме це й знайшлося на демо-базі,
 * де поповнення лишилися за межами двадцятки.
 *
 * Звідси конфігурація тесту: одне старе поповнення й 25 новіших списань. На
 * ній фільтрація вже отриманої сторінки дала б порожній список, а фільтрація
 * запросом — знаходить.
 *
 * Потрібна піднята локальна база: docker compose -f compose.dev.yml up -d
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/database.module.js';
import { ExternalBusyRepository } from '../src/scheduling/external-busy.repository.js';
import { StudentDirectoryAdapter } from '../src/billing/student-directory.adapter.js';
import { NoopOutboxFlush } from '../src/outbox/flush.js';
import { BillingService } from '../src/billing/billing.service.js';
import { ChargeAdapter } from '../src/billing/charge.adapter.js';
import { StudentsRepository } from '../src/billing/students.repository.js';
import { TransactionsRepository } from '../src/billing/transactions.repository.js';
import { EventBus } from '../src/events/event-bus.js';
import { AvailabilityRepository } from '../src/scheduling/availability.repository.js';
import { LessonsAdapter } from '../src/scheduling/lessons.adapter.js';
import { SchedulingService } from '../src/scheduling/scheduling.service.js';
import { SlotsRepository } from '../src/scheduling/slots.repository.js';
import { TeachersRepository } from '../src/scheduling/teachers.repository.js';

const db = createDatabase();
const slots = new SlotsRepository(db);
const students = new StudentsRepository(db);
const transactions = new TransactionsRepository(db);
const teachers = new TeachersRepository(db);
const availability = new AvailabilityRepository(db);
const charge = new ChargeAdapter(students, transactions);
const events = new EventBus();
const scheduling = new SchedulingService(
  db, slots, teachers, availability, charge, events,
  new ExternalBusyRepository(db),
  new StudentDirectoryAdapter(students),
  new NoopOutboxFlush(),
);
const billing = new BillingService(
  db, students, transactions, new LessonsAdapter(slots, scheduling), new NoopOutboxFlush(),
);

const PRICE = 50_000;
const TOPUP = 2_000_000;
/** Більше за вікно журналу (20), інакше поповнення в нього все одно влізло б. */
const CHARGES = 25;

let studentId: number;

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
    password_hash: 'x', timezone: 'Europe/Kyiv',
  }).returning('id').executeTakeFirstOrThrow();
  studentId = s.id;

  // Час задається явно: журнал мусить читатися хронологічно, а не в порядку
  // вставки. Поповнення — найстаріша операція, списання йдуть після нього.
  const base = new Date('2026-01-01T00:00:00Z');
  const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000);

  await db.insertInto('transactions').values({
    student_id: studentId, amount_minor: TOPUP, kind: 'topup',
    slot_id: null, comment: 'оплата наперед', created_at: at(0),
  }).execute();

  await db.insertInto('transactions').values(
    Array.from({ length: CHARGES }, (_, i) => ({
      student_id: studentId, amount_minor: -PRICE, kind: 'lesson_charge' as const,
      slot_id: null, comment: null, created_at: at(i + 1),
    })),
  ).execute();

  await students.shiftBalance(studentId, TOPUP - PRICE * CHARGES);
}

beforeEach(reset);
afterAll(async () => { await db.destroy(); });

describe('історія операцій', () => {
  it('без фільтра вікно забите списаннями, і поповнення в ньому немає', async () => {
    const all = await billing.history(studentId);

    // Не вада, а умова задачі: саме через це фільтр і потрібен.
    expect(all).toHaveLength(20);
    expect(all.every((t) => t.amountMinor < 0)).toBe(true);
  });

  it('надходження знаходяться попри те, що випали з вікна', async () => {
    const incoming = await billing.history(studentId, 'in');

    expect(incoming).toHaveLength(1);
    expect(incoming[0]!.kind).toBe('topup');
    expect(incoming[0]!.amountMinor).toBe(TOPUP);
  });

  it('списання віддаються лише списаннями', async () => {
    const outgoing = await billing.history(studentId, 'out');

    expect(outgoing).toHaveLength(20);
    expect(outgoing.every((t) => t.amountMinor < 0)).toBe(true);
  });

  it('повернення — надходження, хоч вид операції й інший', async () => {
    // Напрямок береться зі знака суми, а не з переліку видів. Якби фільтр
    // порівнював kind із 'topup', повернення зникло б з обох списків.
    await transactions.add({
      studentId, amountMinor: PRICE, kind: 'refund', comment: 'скасовано вчасно',
    });

    const incoming = await billing.history(studentId, 'in');

    expect(incoming.map((t) => t.kind)).toEqual(['refund', 'topup']);
  });

  it('найновіші спершу в кожному напрямку', async () => {
    const outgoing = await billing.history(studentId, 'out');
    const times = outgoing.map((t) => Date.parse(t.at));

    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});
