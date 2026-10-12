/**
 * Доступність з урахуванням зайнятості поза нашим розкладом.
 *
 * Тест інтеграційний, і це не формальність: уся перевірка тримається на
 * операторі `&&` над `tstzrange` і на тому, що інтервал напіввідкритий `[)`.
 * Межа «зовнішня подія закінчується рівно тоді, коли починається заняття» у
 * коді виглядала б правильно за будь-якої реалізації — а в базі вона або
 * конфлікт, або ні.
 *
 * Потрібна піднята локальна база: docker compose -f compose.dev.yml up -d
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/database.module.js';
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
const availability = new AvailabilityRepository(db);
const externalBusy = new ExternalBusyRepository(db);
const scheduling = new SchedulingService(
  db, slots, teachers, availability,
  new ChargeAdapter(students, transactions),
  new EventBus(),
  externalBusy,
);

const START = new Date('2027-07-10T13:00:00Z');
const END = new Date('2027-07-10T14:00:00Z');
const WEEK_FROM = new Date('2027-07-05T00:00:00Z');
const WEEK_TO = new Date('2027-07-20T00:00:00Z');
const PRICE = 50_000;

let teacherId: number;
let otherTeacherId: number;
let studentId: number;

async function reset(): Promise<void> {
  await db.deleteFrom('external_busy').execute();
  await db.deleteFrom('notifications').execute();
  await db.deleteFrom('payments').execute();
  await db.deleteFrom('transactions').execute();
  await db.deleteFrom('slots').execute();
  await db.deleteFrom('students').execute();
  await db.deleteFrom('teachers').execute();

  const [t, other] = await db.insertInto('teachers').values([
    {
      name: 'Викладач', email: 't@test.local', password_hash: 'x',
      timezone: 'Europe/Kyiv', default_price_minor: PRICE,
    },
    {
      name: 'Інший', email: 't2@test.local', password_hash: 'x',
      timezone: 'Europe/Kyiv', default_price_minor: PRICE,
    },
  ]).returning('id').execute();
  teacherId = t!.id;
  otherTeacherId = other!.id;

  const s = await db.insertInto('students').values({
    teacher_id: teacherId, name: 'Студент', email: 's@test.local',
    password_hash: 'x', timezone: 'Europe/Kyiv',
  }).returning('id').executeTakeFirstOrThrow();
  studentId = s.id;
}

/** Вільний слот 13:00–14:00, якщо не сказано інакше. */
async function freeSlot(start = START, end = END, owner = teacherId): Promise<number> {
  const row = await db.insertInto('slots').values({
    teacher_id: owner, start_at: start, end_at: end, price_minor: PRICE, status: 'free',
  }).returning('id').executeTakeFirstOrThrow();
  return row.id;
}

const busy = (start: Date, end: Date, owner = teacherId) =>
  externalBusy.upsert(owner, { startAt: start, endAt: end, title: 'Лікар' });

const availableIds = async () =>
  (await slots.availableSlots(teacherId, WEEK_FROM, WEEK_TO)).map((s) => s.id);

beforeEach(reset);
afterAll(async () => { await db.destroy(); });

describe('вільні години', () => {
  it('без зовнішньої зайнятості віддаються всі вільні слоти', async () => {
    const id = await freeSlot();
    expect(await availableIds()).toEqual([id]);
  });

  it('слот, що накладається на зовнішню подію, зникає з доступних', async () => {
    const id = await freeSlot();
    await busy(new Date('2027-07-10T13:30:00Z'), new Date('2027-07-10T15:00:00Z'));

    expect(await availableIds()).toEqual([]);
    expect(await slots.blockedByExternal(teacherId, WEEK_FROM, WEEK_TO)).toEqual(new Set([id]));
  });

  it('зовнішня подія, що повністю накриває слот, так само блокує', async () => {
    await freeSlot();
    await busy(new Date('2027-07-10T08:00:00Z'), new Date('2027-07-10T20:00:00Z'));
    expect(await availableIds()).toEqual([]);
  });

  it('подія, що закінчується РІВНО на початку слота, не блокує', async () => {
    // напіввідкритий інтервал [): 12:00–13:00 і 13:00–14:00 не перетинаються
    const id = await freeSlot();
    await busy(new Date('2027-07-10T12:00:00Z'), START);
    expect(await availableIds()).toEqual([id]);
  });

  it('подія, що починається РІВНО в кінці слота, не блокує', async () => {
    const id = await freeSlot();
    await busy(END, new Date('2027-07-10T15:00:00Z'));
    expect(await availableIds()).toEqual([id]);
  });

  it('зайнятість ІНШОГО викладача не чіпає наші слоти', async () => {
    const id = await freeSlot();
    await busy(START, END, otherTeacherId);
    expect(await availableIds()).toEqual([id]);
  });

  it('зайнятий слот у доступних не з’являється й без зовнішніх подій', async () => {
    await db.insertInto('slots').values({
      teacher_id: teacherId, start_at: START, end_at: END, price_minor: PRICE,
      status: 'booked', student_id: studentId, paid_at: START,
    }).execute();

    expect(await availableIds()).toEqual([]);
  });

  it('прибраний інтервал повертає слот у доступні', async () => {
    const id = await freeSlot();
    const b = await busy(START, END);
    expect(await availableIds()).toEqual([]);

    await externalBusy.remove(b.id, teacherId);
    expect(await availableIds()).toEqual([id]);
  });
});

describe('календар студента', () => {
  it('заблокований слот показується як busy, а не зникає з сітки', async () => {
    const id = await freeSlot();
    await busy(START, END);

    const view = await scheduling.calendar(teacherId, WEEK_FROM, WEEK_TO, studentId);

    // слот лишився у відповіді — зниклий без причини слот читається як поломка
    expect(view).toHaveLength(1);
    expect(view[0]).toMatchObject({ id, state: 'busy' });
  });

  it('без зайнятості той самий слот вільний', async () => {
    await freeSlot();
    const view = await scheduling.calendar(teacherId, WEEK_FROM, WEEK_TO, studentId);
    expect(view[0]).toMatchObject({ state: 'free' });
  });
});

describe('повторна синхронізація', () => {
  it('подія з тим самим external_id оновлюється, а не дублюється', async () => {
    await freeSlot();
    await externalBusy.upsert(teacherId, {
      startAt: START, endAt: END, source: 'google', externalId: 'evt-1', title: 'Зустріч',
    });
    // у чужому календарі подію перенесли
    await externalBusy.upsert(teacherId, {
      startAt: new Date('2027-07-11T13:00:00Z'),
      endAt: new Date('2027-07-11T14:00:00Z'),
      source: 'google', externalId: 'evt-1', title: 'Зустріч',
    });

    const rows = await externalBusy.list(teacherId, WEEK_FROM, WEEK_TO);
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0]!.start_at).toISOString()).toBe('2027-07-11T13:00:00.000Z');
    // а слот, який блокувався раніше, знову доступний
    expect(await availableIds()).toHaveLength(1);
  });

  it('ручні записи не конфліктують між собою: external_id порожній', async () => {
    await busy(START, END);
    await busy(new Date('2027-07-11T13:00:00Z'), new Date('2027-07-11T14:00:00Z'));

    expect(await externalBusy.list(teacherId, WEEK_FROM, WEEK_TO)).toHaveLength(2);
  });
});
