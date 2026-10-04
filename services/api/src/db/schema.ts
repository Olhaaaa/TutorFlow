/**
 * Опис схеми для Kysely. Імена колонок — snake_case, як у базі.
 * Доменні типи з @tutorflow/core навмисно НЕ використовуються тут: шар даних
 * не повинен тягнути домен, перетворення робиться в сервісах.
 */
import type { ColumnType, Generated, GeneratedAlways } from 'kysely';

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type SlotStatusColumn = 'free' | 'pre_booked' | 'booked' | 'done' | 'cancelled_late';
export type TransactionKindColumn = 'topup' | 'lesson_charge' | 'refund' | 'adjustment';

export interface TeachersTable {
  id: Generated<number>;
  name: string;
  email: string;
  password_hash: string;
  timezone: string;
  default_price_minor: number;
  cancel_hours: Generated<number>;
  payment_deadline_hours: Generated<number>;
  created_at: Generated<Timestamp>;
}

export interface StudentsTable {
  id: Generated<number>;
  teacher_id: number;
  name: string;
  email: string;
  password_hash: string;
  balance_minor: Generated<number>;
  timezone: string;
  telegram_chat_id: number | null;
  telegram_link_code: string | null;
  created_at: Generated<Timestamp>;
}

export interface AvailabilityRulesTable {
  id: Generated<number>;
  teacher_id: number;
  weekday: number;
  /** Локальний настінний час викладача, 'HH:MM:SS'. Зона — з teachers.timezone. */
  start_time: string;
  duration_min: number;
  price_minor: number;
  is_active: Generated<boolean>;
}

export interface EnrollmentsTable {
  id: Generated<number>;
  student_id: number;
  weekday: number;
  start_time: string;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
}

export interface SlotsTable {
  id: Generated<number>;
  teacher_id: number;
  start_at: Timestamp;
  end_at: Timestamp;
  /** Обчислюється базою з start_at і end_at. Вставляти не можна — звідси GeneratedAlways. */
  period: GeneratedAlways<string>;
  price_minor: number;
  status: Generated<SlotStatusColumn>;
  student_id: number | null;
  enrollment_id: number | null;
  hold_expires_at: Timestamp | null;
  paid_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface TransactionsTable {
  id: Generated<number>;
  student_id: number;
  amount_minor: number;
  kind: TransactionKindColumn;
  slot_id: number | null;
  comment: string | null;
  created_at: Generated<Timestamp>;
}

export interface DB {
  teachers: TeachersTable;
  students: StudentsTable;
  availability_rules: AvailabilityRulesTable;
  enrollments: EnrollmentsTable;
  slots: SlotsTable;
  transactions: TransactionsTable;
}
