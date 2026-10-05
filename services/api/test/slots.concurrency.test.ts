/**
 * Головний інваріант розкладу: один слот не може дістатись двом студентам.
 *
 * Тест має сенс ЛИШЕ проти справжнього PostgreSQL. У базі в памʼяті немає ні
 * серіалізації одночасних UPDATE одного рядка, ні exclusion constraint, тому
 * зелений тест там нічого не доводив би.
 *
 * Потрібна піднята локальна база: docker compose -f compose.dev.yml up -d
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDatabase } from '../src/db/database.module.js';
import { SlotsRepository } from '../src/scheduling/slots.repository.js';

const db = createDatabase();
const repo = new SlotsRepository(db);

const NOW = new Date('2027-06-01T09:00:00Z');
const START = new Date('2027-06-10T13:00:00Z');
const END = new Date('2027-06-10T14:00:00Z');

let teacherId: number;
let studentIds: number[];
let slotId: number;

async function reset(): Promise<void> {
  // payments першими: вони посилаються на журнал, і база не дасть видалити
  // проводку, на яку є платіж
  await db.deleteFrom('payments').execute();
  await db.deleteFrom('transactions').execute();
  await db.deleteFrom('slots').execute();
  await db.deleteFrom('enrollments').execute();
  await db.deleteFrom('availability_rules').execute();
  await db.deleteFrom('students').execute();
  await db.deleteFrom('teachers').execute();

  const t = await db.insertInto('teachers').values({
    name: 'Викладач', email: 't@test.local', password_hash: 'x',
    timezone: 'Europe/Kyiv', default_price_minor: 50000,
  }).returning('id').executeTakeFirstOrThrow();
  teacherId = t.id;

  const students = await db.insertInto('students').values(
    Array.from({ length: 20 }, (_, i) => ({
      teacher_id: teacherId, name: `Студент ${i}`,
      email: `s${i}@test.local`, password_hash: 'x', timezone: 'America/New_York',
    })),
  ).returning('id').execute();
  studentIds = students.map((s) => s.id);

  const slot = await db.insertInto('slots').values({
    teacher_id: teacherId, start_at: START, end_at: END,
    price_minor: 50000, status: 'free',
  }).returning('id').executeTakeFirstOrThrow();
  slotId = slot.id;
}

beforeEach(reset);
afterAll(async () => { await db.destroy(); });

describe('атомарне захоплення слота', () => {
  it('20 паралельних бронювань одного слота: виграє РІВНО один', async () => {
    const attempts = studentIds.map((sid) =>
      repo.claimFree(slotId, sid, { status: 'booked', paidAt: NOW }),
    );
    const results = await Promise.all(attempts);

    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(19);

    const stored = await repo.byId(slotId);
    expect(stored?.status).toBe('booked');
    expect(stored?.student_id).toBe(winners[0]!.student_id);
    expect(stored?.paid_at).not.toBeNull();
  });

  it('змішані бронювання booked і pre_booked: теж рівно один переможець', async () => {
    const results = await Promise.all(
      studentIds.map((sid, i) =>
        repo.claimFree(
          slotId, sid,
          i % 2 === 0
            ? { status: 'booked', paidAt: NOW }
            : { status: 'pre_booked', holdExpiresAt: new Date(START.getTime() - 86_400_000) },
        ),
      ),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it('повторне захоплення вже взятого слота дає null, а не виняток', async () => {
    expect(await repo.claimFree(slotId, studentIds[0]!, { status: 'booked', paidAt: NOW })).not.toBeNull();
    expect(await repo.claimFree(slotId, studentIds[1]!, { status: 'booked', paidAt: NOW })).toBeNull();
  });
});

describe('переходи ідемпотентні', () => {
  it('повторне скасування не падає і повертає null', async () => {
    await repo.claimFree(slotId, studentIds[0]!, { status: 'booked', paidAt: NOW });
    expect(await repo.transition(slotId, 'booked', 'free')).not.toBeNull();
    expect(await repo.transition(slotId, 'booked', 'free')).toBeNull();

    const stored = await repo.byId(slotId);
    expect(stored?.status).toBe('free');
    expect(stored?.student_id).toBeNull();
    expect(stored?.paid_at).toBeNull();
  });

  it('20 паралельних скасувань одного слота: успішне рівно одне', async () => {
    await repo.claimFree(slotId, studentIds[0]!, { status: 'booked', paidAt: NOW });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => repo.transition(slotId, 'booked', 'free')),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });
});

describe('база сама не дає перетину занять', () => {
  it('другий booked на той самий час відхиляється обмеженням', async () => {
    await repo.claimFree(slotId, studentIds[0]!, { status: 'booked', paidAt: NOW });
    await expect(
      db.insertInto('slots').values({
        teacher_id: teacherId,
        start_at: new Date(START.getTime() + 30 * 60_000),
        end_at: new Date(END.getTime() + 30 * 60_000),
        price_minor: 50000, status: 'booked',
        student_id: studentIds[1]!, paid_at: NOW,
      }).execute(),
    ).rejects.toThrow(/slots_no_overlap/);
  });

  it('вільні слоти перетинатись можуть — це альтернативні пропозиції', async () => {
    await expect(
      db.insertInto('slots').values({
        teacher_id: teacherId,
        start_at: new Date(START.getTime() + 30 * 60_000),
        end_at: new Date(END.getTime() + 30 * 60_000),
        price_minor: 50000, status: 'free',
      }).execute(),
    ).resolves.toBeDefined();
  });
});

describe('генерація слотів і перехід на зимовий час', () => {
  it('локальний час викладача сталий, UTC зсувається 25 жовтня 2026', async () => {
    await db.insertInto('availability_rules').values({
      teacher_id: teacherId,
      weekday: 3,                 // середа
      start_time: '16:00',
      duration_min: 60,
      price_minor: 50000,
    }).execute();

    const created = await repo.generateFromRules(
      teacherId, new Date('2026-10-14'), new Date('2026-11-11'),
    );
    expect(created).toBe(5);

    const rows = await sql<{ local_kyiv: string; utc_hour: number }>`
      select to_char(start_at at time zone 'Europe/Kyiv', 'HH24:MI') as local_kyiv,
             extract(hour from start_at at time zone 'UTC')::int      as utc_hour
        from slots
       where teacher_id = ${teacherId}
         and start_at >= '2026-10-01' and start_at < '2026-12-01'
       order by start_at
    `.execute(db);

    // локальний час викладача не змінюється жодного тижня
    expect(rows.rows.map((r) => r.local_kyiv)).toEqual(['16:00', '16:00', '16:00', '16:00', '16:00']);
    // а UTC зсувається: 13 до переходу, 14 після
    expect(rows.rows.map((r) => r.utc_hour)).toEqual([13, 13, 14, 14, 14]);
  });

  it('повторна генерація нічого не дублює', async () => {
    await db.insertInto('availability_rules').values({
      teacher_id: teacherId, weekday: 3, start_time: '16:00',
      duration_min: 60, price_minor: 50000,
    }).execute();

    const first = await repo.generateFromRules(teacherId, new Date('2026-10-14'), new Date('2026-11-11'));
    const second = await repo.generateFromRules(teacherId, new Date('2026-10-14'), new Date('2026-11-11'));
    expect(first).toBe(5);
    expect(second).toBe(0);
  });
});
