/**
 * Чисті правила розкладу.
 *
 * Реалізувати так, щоб позеленіли test/scheduling.test.ts.
 *
 * Жодних імпортів із @nestjs/*, жодного доступу до БД, жодного `new Date()`
 * без аргументів: поточний момент завжди передається параметром `now`.
 * Інакше функції неможливо протестувати детерміновано.
 */
import type { Slot, Teacher } from '../types.js';
import type { SlotStatus } from '../slot.js';

export type BookRejection = 'not_free' | 'in_the_past';

/**
 * Чи можна взяти слот. Умови: статус саме `free` і початок у майбутньому.
 * @returns null якщо можна, інакше причина відмови.
 */
export function bookRejection(slot: Pick<Slot, 'status' | 'startAt'>, now: Date): BookRejection | null {
  throw new Error('не реалізовано: правила розкладу');
}

/**
 * Момент, після якого неоплачений `pre_booked` звільняється.
 * Рівно `startAt` мінус `paymentDeadlineHours`.
 */
export function holdDeadline(startAt: Date, paymentDeadlineHours: number): Date {
  throw new Error('не реалізовано: правила розкладу');
}

/** Чи сплив час на оплату закріпленого слота. Для слота без holdExpiresAt — false. */
export function isHoldExpired(slot: Pick<Slot, 'status' | 'holdExpiresAt'>, now: Date): boolean {
  throw new Error('не реалізовано: правила розкладу');
}

/**
 * Куди переходить слот при скасуванні студентом.
 *
 * - `pre_booked` → завжди `free`: гроші не списувались, повертати нічого,
 *   правило 24 годин не застосовується.
 * - `booked` і до початку залишилось `cancelHours` або більше → `free`,
 *   гроші повертаються.
 * - `booked` і залишилось менше → `cancelled_late`, гроші лишаються викладачу.
 *
 * Для решти статусів — помилка: скасовувати нічого.
 */
export function cancelOutcome(
  slot: Pick<Slot, 'status' | 'startAt'>,
  now: Date,
  cancelHours: Teacher['cancelHours'],
): Extract<SlotStatus, 'free' | 'cancelled_late'> {
  throw new Error('не реалізовано: правила розкладу');
}

/** Чи скасування безкоштовне, тобто чи повертати кошти. */
export function isCancellationFree(
  slot: Pick<Slot, 'status' | 'startAt'>,
  now: Date,
  cancelHours: Teacher['cancelHours'],
): boolean {
  throw new Error('не реалізовано: правила розкладу');
}

/** Чи час заняття минув і `booked` слот пора перевести в `done`. */
export function isCompleted(slot: Pick<Slot, 'status' | 'endAt'>, now: Date): boolean {
  throw new Error('не реалізовано: правила розкладу');
}
