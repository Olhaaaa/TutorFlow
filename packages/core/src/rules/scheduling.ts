/**
 * Чисті правила розкладу.
 *
 * Жодних імпортів із @nestjs/*, жодного доступу до БД, жодного `new Date()`
 * без аргументів: поточний момент завжди приходить параметром `now`.
 * Інакше функції неможливо протестувати детерміновано.
 */
import type { Slot, Teacher } from '../types.js';
import type { SlotStatus } from '../slot.js';

const MS_PER_HOUR = 3_600_000;

export type BookRejection = 'not_free' | 'in_the_past';

/** Скільки годин залишилось до моменту `at`. Відʼємне значення — момент у минулому. */
export function hoursUntil(at: Date, now: Date): number {
  return (at.getTime() - now.getTime()) / MS_PER_HOUR;
}

/**
 * Чи можна взяти слот. Умови: статус саме `free` і початок у майбутньому.
 * @returns null якщо можна, інакше причина відмови.
 */
export function bookRejection(
  slot: Pick<Slot, 'status' | 'startAt'>,
  now: Date,
): BookRejection | null {
  if (slot.status !== 'free') return 'not_free';
  if (slot.startAt.getTime() <= now.getTime()) return 'in_the_past';
  return null;
}

/**
 * Момент, після якого неоплачений `pre_booked` звільняється:
 * `startAt` мінус `paymentDeadlineHours`.
 */
export function holdDeadline(startAt: Date, paymentDeadlineHours: number): Date {
  return new Date(startAt.getTime() - paymentDeadlineHours * MS_PER_HOUR);
}

/** Чи сплив час на оплату. Для слота без `holdExpiresAt` — завжди false. */
export function isHoldExpired(
  slot: Pick<Slot, 'status' | 'holdExpiresAt'>,
  now: Date,
): boolean {
  if (slot.status !== 'pre_booked' || slot.holdExpiresAt === null) return false;
  return slot.holdExpiresAt.getTime() <= now.getTime();
}

export class NothingToCancelError extends Error {
  constructor(readonly status: SlotStatus) {
    super(`скасовувати нічого: слот у статусі ${status}`);
    this.name = 'NothingToCancelError';
  }
}

/**
 * Куди переходить слот при скасуванні студентом.
 *
 * - `pre_booked` → завжди `free`: гроші не списувались, повертати нічого,
 *   правило `cancelHours` не застосовується.
 * - `booked`, до початку залишилось `cancelHours` або більше → `free`.
 *   Межа ВКЛЮЧНА: рівно за 24 години скасування ще безкоштовне.
 * - `booked`, залишилось менше → `cancelled_late`.
 */
export function cancelOutcome(
  slot: Pick<Slot, 'status' | 'startAt'>,
  now: Date,
  cancelHours: Teacher['cancelHours'],
): Extract<SlotStatus, 'free' | 'cancelled_late'> {
  if (slot.status === 'pre_booked') return 'free';
  if (slot.status !== 'booked') throw new NothingToCancelError(slot.status);
  return hoursUntil(slot.startAt, now) >= cancelHours ? 'free' : 'cancelled_late';
}

/** Чи скасування безкоштовне, тобто чи повертати кошти. */
export function isCancellationFree(
  slot: Pick<Slot, 'status' | 'startAt'>,
  now: Date,
  cancelHours: Teacher['cancelHours'],
): boolean {
  return cancelOutcome(slot, now, cancelHours) === 'free';
}

/** Чи час заняття минув і `booked` слот пора перевести в `done`. */
export function isCompleted(slot: Pick<Slot, 'status' | 'endAt'>, now: Date): boolean {
  return slot.status === 'booked' && slot.endAt.getTime() <= now.getTime();
}
