/**
 * Опис схеми для Kysely. Імена колонок — snake_case, як у базі.
 * Доменні типи з @tutorflow/core навмисно НЕ використовуються тут: шар даних
 * не повинен тягнути домен, перетворення робиться в сервісах.
 */
import type { ColumnType, Generated, GeneratedAlways } from 'kysely';

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type SlotStatusColumn = 'free' | 'pre_booked' | 'booked' | 'done' | 'cancelled_late';
export type TransactionKindColumn = 'topup' | 'lesson_charge' | 'refund' | 'adjustment';
export type PaymentProviderColumn = 'monobank';
export type PaymentStatusColumn = 'pending' | 'paid' | 'failed' | 'expired';

export interface TeachersTable {
  id: Generated<number>;
  name: string;
  email: string;
  password_hash: string;
  timezone: string;
  default_price_minor: number;
  cancel_hours: Generated<number>;
  payment_deadline_hours: Generated<number>;
  /** Еквайринг викладача. Три поля заповнені або всі порожні — так у базі. */
  payment_provider: PaymentProviderColumn | null;
  /** AES-256-GCM, формат `v1:iv:tag:ciphertext`. Назовні не віддається ніколи. */
  payment_token_encrypted: string | null;
  payments_connected_at: Timestamp | null;
  /** Секрет у рядку адреси стрічки .ics: календарна програма не вміє входити. */
  calendar_token: string | null;
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
  /**
   * Розгорнуто, а не Generated<Timestamp>: час проводки іноді задається явно
   * (сідер вносить поповнення заднім числом, щоб журнал читався хронологічно),
   * а вкладений ColumnType робить колонку недоступною для вставки значення.
   */
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface PaymentsTable {
  id: Generated<number>;
  student_id: number;
  /** Мерчант, який виставив рахунок. Його ключем перевіряється вебхук. */
  teacher_id: number | null;
  provider: PaymentProviderColumn;
  /** invoiceId провайдера. Null, доки рахунок не створено. */
  provider_payment_id: string | null;
  amount_minor: number;
  status: Generated<PaymentStatusColumn>;
  page_url: string | null;
  /** Останнє тіло вебхука як є. */
  raw: ColumnType<unknown, string | null, string | null>;
  transaction_id: number | null;
  created_at: Generated<Timestamp>;
  /**
   * На відміну від created_at цю колонку МИ оновлюємо, тому тип написаний
   * розгорнуто: при вставці необовʼязкова (є default), при оновленні — Date.
   * Generated<Timestamp> тут не підходить: вкладений ColumnType робить колонку
   * недоступною для .set().
   */
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface NotificationsTable {
  id: Generated<number>;
  student_id: number;
  /** Тип події, з якої нагадування народилось. */
  kind: string;
  text: string;
  payload: ColumnType<unknown, string, string>;
  /** Ідемпотентність споживача подій: unique у базі, а не перевірка в коді. */
  dedup_key: string;
  created_at: Generated<Timestamp>;
  /** Канал доставки й час — заповнюються лише парою. */
  channel: string | null;
  sent_at: Timestamp | null;
}

/**
 * Зайнятість викладача поза нашим розкладом. Інтервалом, а не годиною:
 * зовнішні події не вирівняні по нашій сітці.
 */
export interface ExternalBusyTable {
  id: Generated<number>;
  teacher_id: number;
  start_at: Timestamp;
  end_at: Timestamp;
  source: Generated<'manual' | 'google' | 'ics'>;
  external_id: string | null;
  title: string | null;
  /** Обчислюється базою з start_at і end_at. Вставляти не можна. */
  period: GeneratedAlways<string>;
  created_at: Generated<Timestamp>;
}

export interface DB {
  teachers: TeachersTable;
  students: StudentsTable;
  availability_rules: AvailabilityRulesTable;
  enrollments: EnrollmentsTable;
  slots: SlotsTable;
  transactions: TransactionsTable;
  payments: PaymentsTable;
  notifications: NotificationsTable;
  external_busy: ExternalBusyTable;
}
