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

export class LessonAlreadyStartedError extends Error {
  constructor(readonly startAt: Date) {
    super(`заняття вже почалось (${startAt.toISOString()}) — скасовувати нічого`);
    this.name = 'LessonAlreadyStartedError';
  }
}

/** Що робить скасування викладачем: слот звільняється, кошти іноді повертаються. */
export interface TeacherCancelOutcome {
  status: Extract<SlotStatus, 'free'>;
  /** Чи є що повертати: гроші списані лише в `booked`. */
  refund: boolean;
}

/**
 * Скасування ВИКЛАДАЧЕМ. Відрізняється від студентського двома речами.
 *
 * Перша: правило `cancelHours` не застосовується. Воно захищає час викладача
 * від студента, який передумав за годину до заняття; застосувати його до того,
 * хто сам скасував, означало б оштрафувати потерпілого. Тому результат завжди
 * `free`, а `cancelled_late` тут не виникає ніколи.
 *
 * Друга: повернення коштів залежить не від строку, а лише від того, чи були
 * вони списані. `pre_booked` — місце трималось, але не оплачене, і «повернення»
 * за нього створило б із повітря суму, якої студент не платив.
 *
 * Заняття, яке вже почалось, скасувати не можна: воно або відбулось, або
 * закриється як проведене фоновим проходом. Скасовувати минуле — це вже не
 * розклад, а виправлення журналу, і робиться воно `adjustment`-проводкою.
 */
export function teacherCancelOutcome(
  slot: Pick<Slot, 'status' | 'startAt'>,
  now: Date,
): TeacherCancelOutcome {
  if (slot.status !== 'booked' && slot.status !== 'pre_booked') {
    throw new NothingToCancelError(slot.status);
  }
  if (slot.startAt.getTime() <= now.getTime()) {
    throw new LessonAlreadyStartedError(slot.startAt);
  }
  return { status: 'free', refund: slot.status === 'booked' };
}

/** Вікно часу, у якому прохід воркера шукає, про що нагадати. */
export interface ReminderWindow {
  from: Date;
  to: Date;
}

/**
 * За скільки годин до події нагадувати. Доба — бо нагадування має сенс лише
 * тоді, коли на нього ще можна зреагувати: скасувати вчасно (правило 24 години)
 * або заплатити.
 */
export const REMINDER_LEAD_HOURS = 24;

/**
 * Вікно, у якому шукаються події для нагадування.
 *
 * Прохід воркера не має памʼяті про те, кому вже нагадано, і це навмисно:
 * «нагадування надіслане» — факт журналу нагадувань, а не властивість слота,
 * і тягнути його в розклад означало б розмазати межу між вертикалями.
 *
 * Замість памʼяті — вікно: беруться події, до яких лишилось приблизно
 * `REMINDER_LEAD_HOURS`, із запасом назад на `lookbackMin` хвилин. Запас
 * потрібен, бо прохід не точний: якщо воркер лежав десять хвилин, подія без
 * запасу випала б із вікна назавжди.
 *
 * Ціна запасу — та сама подія потрапляє в кілька проходів. Це не проблема
 * рівно тому, що споживач ідемпотентний: `notifications.dedup_key` не дасть
 * створити друге нагадування. Тобто продюсер свідомо at-least-once, і це
 * узгоджене з рештою системи рішення, а не недогляд.
 */
export function reminderWindow(now: Date, lookbackMin: number): ReminderWindow {
  const target = now.getTime() + REMINDER_LEAD_HOURS * 3_600_000;
  return {
    from: new Date(target - lookbackMin * 60_000),
    to: new Date(target),
  };
}
