import type { Minor } from './money.js';
import type { SlotStatus } from './slot.js';

/** Назва зони з IANA tzdata, напр. 'Europe/Kyiv' або 'America/New_York'. */
export type IanaTimeZone = string;

/** 0 — неділя, як у PostgreSQL `extract(dow …)` і в JS `Date#getDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Локальний настінний час без зони, 'HH:MM'. */
export type WallClock = `${number}:${number}` | string;

export interface Teacher {
  id: number;
  name: string;
  email: string;
  timezone: IanaTimeZone;
  defaultPriceMinor: Minor;
  /** За скільки годин до початку скасування ще безкоштовне. */
  cancelHours: number;
  /** За скільки годин до початку pre_booked мусить бути оплачений. */
  paymentDeadlineHours: number;
}

export interface Student {
  id: number;
  teacherId: number;
  name: string;
  email: string;
  balanceMinor: Minor;
  timezone: IanaTimeZone;
}

/** Тижневий шаблон доступності. Час локальний для викладача. */
export interface AvailabilityRule {
  id: number;
  teacherId: number;
  weekday: Weekday;
  startTime: WallClock;
  durationMin: number;
  priceMinor: Minor;
  isActive: boolean;
}

/** Постійне місце студента в розкладі. */
export interface Enrollment {
  id: number;
  studentId: number;
  weekday: Weekday;
  startTime: WallClock;
  isActive: boolean;
}

export interface Slot {
  id: number;
  teacherId: number;
  /** Завжди UTC. Локальний час — лише на межі відображення. */
  startAt: Date;
  endAt: Date;
  priceMinor: Minor;
  status: SlotStatus;
  studentId: number | null;
  enrollmentId: number | null;
  /** Лише для pre_booked: момент, після якого слот звільняється. */
  holdExpiresAt: Date | null;
  paidAt: Date | null;
}

export type TransactionKind = 'topup' | 'lesson_charge' | 'refund' | 'adjustment';

export interface Transaction {
  id: number;
  studentId: number;
  /** Знак має значення: topup додатний, lesson_charge відʼємний. */
  amountMinor: Minor;
  kind: TransactionKind;
  slotId: number | null;
  comment: string | null;
  createdAt: Date;
}
