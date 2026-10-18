/**
 * Власність студента: маршрути кабінету викладача беруть `studentId` зі шляху,
 * тому кожен з них мусить сам перевірити, що студент належить саме цьому
 * викладачеві. Guard автентифікації цього не робить і не може: він знає роль,
 * але не знає, про чий рядок питають.
 *
 * Тест інтеграційний, бо перевіряє саме звʼязок `students.teacher_id` у базі,
 * а не арифметику. Два викладачі й студент у першого з них — мінімальна
 * конфігурація, у якій видно різницю між своїм і чужим.
 *
 * Потрібна піднята локальна база: docker compose -f compose.dev.yml up -d
 */
import { NotFoundException } from '@nestjs/common';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/database.module.js';
import { BillingService } from '../src/billing/billing.service.js';
import { ChargeAdapter } from '../src/billing/charge.adapter.js';
import { StudentsRepository } from '../src/billing/students.repository.js';
import { TransactionsRepository } from '../src/billing/transactions.repository.js';
import { EventBus } from '../src/events/event-bus.js';
import { AvailabilityRepository } from '../src/scheduling/availability.repository.js';
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
// Шина без REDIS_URL вимкнена: тут перевіряється доступ, а не доставка подій.
const events = new EventBus();
const scheduling = new SchedulingService(db, slots, teachers, availability, charge, events);
const billing = new BillingService(db, students, transactions, slots, scheduling);

const PRICE = 50_000;
const TOPUP = 120_000;

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

  // Поповнення вноситься парою «проводка + зсув кешу», як це робить білінг:
  // інакше звірка не мала б чого звіряти.
  await transactions.add({ studentId, amountMinor: TOPUP, kind: 'topup' });
  await students.shiftBalance(studentId, TOPUP);
}

beforeEach(reset);
afterAll(async () => { await db.destroy(); });

describe('звірка балансу доступна лише своєму викладачеві', () => {
  it('власний студент: звірка віддає кеш, журнал і висновок', async () => {
    const result = await billing.audit(teacherId, studentId);

    expect(result).toEqual({ cached: TOPUP, fromJournal: TOPUP, consistent: true });
  });

  it('студент ІНШОГО викладача: 404, і жодної суми назовні', async () => {
    await expect(billing.audit(otherTeacherId, studentId)).rejects.toThrow(NotFoundException);
  });

  it('студента з таким номером немає взагалі: той самий 404', async () => {
    // Відповідь не відрізняється від чужого студента навмисно: інакше перебір
    // номерів показував би, які студенти в системі існують.
    await expect(billing.audit(teacherId, studentId + 10_000)).rejects.toThrow(NotFoundException);
  });
});

describe('поповнення так само перевіряє власність', () => {
  it('чужому студентові поповнити не можна, і баланс не рухається', async () => {
    await expect(billing.topup(otherTeacherId, studentId, PRICE)).rejects.toThrow(NotFoundException);

    const student = await students.byId(studentId);
    expect(student?.balance_minor).toBe(TOPUP);
    expect(await transactions.sum(studentId)).toBe(TOPUP);
  });
});
