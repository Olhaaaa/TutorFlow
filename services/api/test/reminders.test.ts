/**
 * Нагадування про заняття й про строк оплати.
 *
 * Перевіряється не текст — його перевіряє ядро, — а ВИБІРКА: що потрапляє у
 * вікно, а що ні. Тест інтеграційний, бо вікно накладається на `timestamptz` у
 * базі, і саме там живуть межі включно/виключно, через які нагадування
 * приходить двічі або не приходить узагалі.
 *
 * Шина замінена на збирач: нас цікавить, які події опубліковані, а не те, чи
 * доїхали вони до Redis.
 *
 * Потрібна піднята локальна база: docker compose -f compose.dev.yml up -d
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { REMINDER_LEAD_HOURS } from '@tutorflow/core';
import { createDatabase } from '../src/db/database.module.js';
import type { EventBus } from '../src/events/event-bus.js';
import type { DomainEvent } from '@tutorflow/contracts';
import { RemindersService } from '../src/scheduling/reminders.service.js';
import { SlotsRepository } from '../src/scheduling/slots.repository.js';
import { TeachersRepository } from '../src/scheduling/teachers.repository.js';
import type { SlotStatusColumn } from '../src/db/schema.js';

const db = createDatabase();
const slots = new SlotsRepository(db);

/** Замість шини — список: тест дивиться, що саме опубліковано. */
const published: DomainEvent[] = [];
const bus = {
  enabled: true,
  publish: async (event: DomainEvent) => {
    published.push(event);
  },
} as unknown as EventBus;

const teachersRepo = new TeachersRepository(db);
const reminders = new RemindersService(slots, bus, teachersRepo);

const NOW = new Date('2027-07-01T09:00:00Z');
const PRICE = 50_000;
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

let teacherId: number;
let studentId: number;

async function reset(): Promise<void> {
  published.length = 0;
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
}

/**
 * Слот потрібного статусу.
 *
 * `durationMin` існує через обмеження самої моделі: заняття викладача не
 * перетинаються (`slots_no_overlap` для всього, крім `free`), а вікно
 * нагадувань — усього 15 хвилин. Тому там, де тесту потрібні кілька зайнятих
 * слотів в одному вікні, вони мусять бути короткими.
 *
 * `paid_at` ставиться для всіх статусів, у яких гроші вже списані: так вимагає
 * `slots_paid_matches`, і це не дрібниця тесту, а те саме правило, що в домені.
 */
async function makeSlot(
  status: SlotStatusColumn,
  startAt: Date,
  holdExpiresAt: Date | null = null,
  durationMin = 60,
): Promise<number> {
  const paid = status === 'booked' || status === 'done' || status === 'cancelled_late';
  const row = await db.insertInto('slots').values({
    teacher_id: teacherId,
    start_at: startAt,
    end_at: new Date(startAt.getTime() + durationMin * 60_000),
    price_minor: PRICE,
    status,
    student_id: status === 'free' ? null : studentId,
    hold_expires_at: holdExpiresAt,
    paid_at: paid ? NOW : null,
  }).returning('id').executeTakeFirstOrThrow();
  return row.id;
}

const kinds = () => published.map((e) => e.type).sort();

beforeEach(reset);
afterAll(async () => { await db.destroy(); });

describe('нагадування про заняття завтра', () => {
  it('оплачене заняття за добу — подія з paid: true', async () => {
    const id = await makeSlot('booked', hours(REMINDER_LEAD_HOURS));

    const r = await reminders.publish(NOW, 15);

    expect(r.lessons).toBe(1);
    expect(published).toEqual([
      expect.objectContaining({ type: 'lesson.upcoming', slotId: id, studentId, paid: true }),
    ]);
  });

  it('неоплачене заняття за добу — подія з paid: false', async () => {
    await makeSlot('pre_booked', hours(REMINDER_LEAD_HOURS), hours(48));

    await reminders.publish(NOW, 15);

    expect(published).toEqual([
      expect.objectContaining({ type: 'lesson.upcoming', paid: false }),
    ]);
  });

  it('заняття через тиждень і заняття через годину не беруться', async () => {
    await makeSlot('booked', hours(24 * 7));
    await makeSlot('booked', hours(1));

    const r = await reminders.publish(NOW, 15);

    expect(r.lessons).toBe(0);
    expect(published).toHaveLength(0);
  });

  it('вільний слот, проведене й скасоване заняття не беруться', async () => {
    const target = hours(REMINDER_LEAD_HOURS);
    const minutes = (n: number) => new Date(target.getTime() - n * 60_000);
    // короткі слоти: три зайнятих в одному вікні інакше перетнулись би
    await makeSlot('free', target, null, 5);
    await makeSlot('done', minutes(5), null, 5);
    await makeSlot('cancelled_late', minutes(10), null, 5);

    const r = await reminders.publish(NOW, 15);

    expect(r.lessons).toBe(0);
  });

  it('запас назад ловить заняття, яке прохід пропустив через простій', async () => {
    // воркер лежав десять хвилин: заняття вже вийшло за точку «рівно доба»
    await makeSlot('booked', new Date(hours(REMINDER_LEAD_HOURS).getTime() - 10 * 60_000));

    expect((await reminders.publish(NOW, 15)).lessons).toBe(1);

    published.length = 0;
    // без запасу те саме заняття вже не знайшлось би
    expect((await reminders.publish(NOW, 0)).lessons).toBe(0);
  });
});

describe('нагадування про строк оплати', () => {
  it('закріплення, у якого строк спливає за добу', async () => {
    const id = await makeSlot('pre_booked', hours(72), hours(REMINDER_LEAD_HOURS));

    const r = await reminders.publish(NOW, 15);

    expect(r.payments).toBe(1);
    expect(published).toEqual([
      expect.objectContaining({ type: 'payment.due', slotId: id, priceMinor: PRICE }),
    ]);
  });

  it('вікно накладається на строк оплати, а не на початок заняття', async () => {
    // заняття аж через три доби, але заплатити треба вже завтра
    await makeSlot('pre_booked', hours(72), hours(REMINDER_LEAD_HOURS));
    // а тут навпаки: заняття завтра, а строк оплати давно позаду
    await makeSlot('pre_booked', hours(REMINDER_LEAD_HOURS), hours(-48));

    const r = await reminders.publish(NOW, 15);

    expect(r.payments).toBe(1);
    expect(r.lessons).toBe(1);
    expect(kinds()).toEqual(['lesson.upcoming', 'payment.due']);
  });

  it('оплачене заняття про оплату не нагадує', async () => {
    await makeSlot('booked', hours(72), null);

    expect((await reminders.publish(NOW, 15)).payments).toBe(0);
  });
});

describe('повторні проходи', () => {
  it('публікують подію знову — і це нормально, бо ключ дедуплікації той самий', async () => {
    await makeSlot('booked', hours(REMINDER_LEAD_HOURS));

    await reminders.publish(NOW, 15);
    await reminders.publish(NOW, 15);

    // продюсер свідомо at-least-once: від другого нагадування захищає
    // notifications.dedup_key, а не памʼять проходу
    expect(published).toHaveLength(2);
    expect(published[0]).toEqual(published[1]);
  });
});

describe('строк нагадування належить викладачеві', () => {
  it('викладач із 48 годинами отримує нагадування за дві доби, а не за одну', async () => {
    await db.updateTable('teachers').set({ reminder_lead_hours: 48 })
      .where('id', '=', teacherId).execute();
    await makeSlot('booked', hours(48));

    expect((await reminders.publish(NOW, 15)).lessons).toBe(1);
  });

  it('те саме заняття за добу такому викладачеві вже не нагадують', async () => {
    await db.updateTable('teachers').set({ reminder_lead_hours: 48 })
      .where('id', '=', teacherId).execute();
    await makeSlot('booked', hours(REMINDER_LEAD_HOURS));

    expect((await reminders.publish(NOW, 15)).lessons).toBe(0);
  });

  it('у двох викладачів із різними строками кожен має своє вікно', async () => {
    const other = await db.insertInto('teachers').values({
      name: 'Інший', email: 't2@test.local', password_hash: 'x',
      timezone: 'Europe/Kyiv', default_price_minor: PRICE, reminder_lead_hours: 48,
    }).returning('id').executeTakeFirstOrThrow();
    const otherStudent = await db.insertInto('students').values({
      teacher_id: other.id, name: 'Студент 2', email: 's2@test.local',
      password_hash: 'x', timezone: 'Europe/Kyiv',
    }).returning('id').executeTakeFirstOrThrow();

    // нашому викладачеві (24 год) — заняття за добу
    await makeSlot('booked', hours(REMINDER_LEAD_HOURS));
    // іншому (48 год) — за дві доби
    await db.insertInto('slots').values({
      teacher_id: other.id, start_at: hours(48), end_at: hours(49),
      price_minor: PRICE, status: 'booked', student_id: otherStudent.id, paid_at: NOW,
    }).execute();

    const r = await reminders.publish(NOW, 15);
    expect(r.lessons).toBe(2);
  });
});
