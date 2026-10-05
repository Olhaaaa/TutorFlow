/**
 * Переходи станів, які робить час.
 *
 * Перевіряється головне: вони справді застосовуються й не чіпають нічого
 * зайвого. До появи цього модуля обидві операції існували як методи, яких
 * ніхто не викликав, — модель обіцяла поведінку, якої не було.
 *
 * Потрібна піднята локальна база: docker compose -f compose.dev.yml up -d
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/database.module.js';
import { PaymentsRepository } from '../src/payments/payments.repository.js';
import { SlotsRepository } from '../src/scheduling/slots.repository.js';

const db = createDatabase();
const slots = new SlotsRepository(db);
const payments = new PaymentsRepository(db);

const NOW = new Date('2027-06-01T12:00:00Z');
const PAST = new Date('2027-05-30T10:00:00Z');
const FUTURE = new Date('2027-06-10T10:00:00Z');

let teacherId: number;
let studentId: number;

async function reset(): Promise<void> {
  await db.deleteFrom('payments').execute();
  await db.deleteFrom('transactions').execute();
  await db.deleteFrom('slots').execute();
  await db.deleteFrom('students').execute();
  await db.deleteFrom('teachers').execute();

  const t = await db.insertInto('teachers').values({
    name: 'Викладач', email: 't@test.local', password_hash: 'x',
    timezone: 'Europe/Kyiv', default_price_minor: 50_000,
  }).returning('id').executeTakeFirstOrThrow();
  teacherId = t.id;

  const s = await db.insertInto('students').values({
    teacher_id: teacherId, name: 'Студент', email: 's@test.local',
    password_hash: 'x', timezone: 'Europe/Kyiv',
  }).returning('id').executeTakeFirstOrThrow();
  studentId = s.id;
}

const hour = (start: Date) => new Date(start.getTime() + 3_600_000);

beforeEach(reset);
afterAll(async () => { await db.destroy(); });

describe('протермінування закріплень', () => {
  it('неоплачене закріплення з простроченим дедлайном звільняється', async () => {
    const slot = await db.insertInto('slots').values({
      teacher_id: teacherId, start_at: FUTURE, end_at: hour(FUTURE),
      price_minor: 50_000, status: 'pre_booked', student_id: studentId,
      hold_expires_at: new Date(NOW.getTime() - 1000),
    }).returning('id').executeTakeFirstOrThrow();

    expect(await slots.expireHolds(NOW)).toHaveLength(1);

    const after = await db.selectFrom('slots').selectAll()
      .where('id', '=', slot.id).executeTakeFirstOrThrow();
    expect(after.status).toBe('free');
    expect(after.student_id).toBeNull();
  });

  it('закріплення з дедлайном у майбутньому не чіпається', async () => {
    await db.insertInto('slots').values({
      teacher_id: teacherId, start_at: FUTURE, end_at: hour(FUTURE),
      price_minor: 50_000, status: 'pre_booked', student_id: studentId,
      hold_expires_at: new Date(NOW.getTime() + 3_600_000),
    }).execute();

    expect(await slots.expireHolds(NOW)).toHaveLength(0);
  });
});

describe('закриття проведених занять', () => {
  it('оплачене заняття, час якого минув, стає done', async () => {
    const slot = await db.insertInto('slots').values({
      teacher_id: teacherId, start_at: PAST, end_at: hour(PAST),
      price_minor: 50_000, status: 'booked', student_id: studentId,
      paid_at: PAST,
    }).returning('id').executeTakeFirstOrThrow();

    expect(await slots.completePast(NOW)).toHaveLength(1);
    const after = await db.selectFrom('slots').selectAll()
      .where('id', '=', slot.id).executeTakeFirstOrThrow();
    expect(after.status).toBe('done');
  });

  it('майбутнє заняття лишається booked, а вільний слот — вільним', async () => {
    await db.insertInto('slots').values([
      {
        teacher_id: teacherId, start_at: FUTURE, end_at: hour(FUTURE),
        price_minor: 50_000, status: 'booked', student_id: studentId, paid_at: NOW,
      },
      {
        teacher_id: teacherId, start_at: PAST, end_at: hour(PAST),
        price_minor: 50_000, status: 'free',
      },
    ]).execute();

    expect(await slots.completePast(NOW)).toHaveLength(0);
  });
});

describe('протермінування рахунків', () => {
  it('рахунок, за яким не заплатили, стає expired', async () => {
    const p = await payments.create({
      studentId, teacherId, provider: 'monobank', amountMinor: 50_000,
    });
    await db.updateTable('payments')
      .set({ created_at: new Date(Date.now() - 2 * 3_600_000) })
      .where('id', '=', p.id).execute();

    expect(await payments.expirePending(60)).toBe(1);
    expect((await payments.byId(p.id))?.status).toBe('expired');
  });
});
