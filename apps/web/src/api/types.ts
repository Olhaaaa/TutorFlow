/** Стани слота очима конкретного глядача. Віддає GET /api/slots. */
export type SlotState =
  | 'free'
  | 'mine_unpaid'
  | 'mine_paid'
  | 'busy'
  | 'mine_done'
  | 'mine_cancelled_late';

export interface SlotView {
  id: number;
  /** ISO 8601 в UTC. Усі перетворення в локальний час — лише при відображенні. */
  startAt: string;
  endAt: string;
  priceMinor: number;
  state: SlotState;
  /** Для свого неоплаченого слота: до коли треба заплатити. */
  payBy: string | null;
}

export interface BookResult {
  id: number;
  status: 'booked' | 'pre_booked';
  paid: boolean;
  payBy: string | null;
}

export interface CancelResult {
  id: number;
  status: 'free' | 'cancelled_late';
  refunded: boolean;
}

/* ---------- кабінет викладача ---------- */

/** Сирий статус заняття в базі. Його бачить лише викладач. */
export type SlotStatus = 'free' | 'pre_booked' | 'booked' | 'done' | 'cancelled_late';

/** Віддає GET /api/teacher/slots. На відміну від SlotView містить імʼя студента. */
export interface TeacherSlotView {
  id: number;
  startAt: string;
  endAt: string;
  priceMinor: number;
  status: SlotStatus;
  student: { id: number; name: string } | null;
  payBy: string | null;
}

/**
 * Поля у snake_case навмисно: ці ендпоінти віддають рядки таблиць як є.
 * Перейменовувати їх на клієнті — означало б завести другий словник назв,
 * який розійдеться з базою.
 */
export interface Student {
  id: number;
  name: string;
  email: string;
  balance_minor: number;
  timezone: string;
}

export interface AvailabilityRule {
  id: number;
  teacher_id: number;
  weekday: number;
  /** Локальний настінний час викладача, формат HH:MM:SS. */
  start_time: string;
  duration_min: number;
  price_minor: number;
  is_active: boolean;
}

export interface TopupResult {
  balanceMinor: number;
  /** Ідентифікатори занять, які поповнення зробило оплаченими. */
  convertedSlots: number[];
}

export interface AuditResult {
  cached: number;
  fromJournal: number;
  consistent: boolean;
}

export interface GenerateResult {
  created: number;
  from: string;
  to: string;
}

/* ---------- платежі ---------- */

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired';

export interface PaymentView {
  id: number;
  amountMinor: number;
  status: PaymentStatus;
  /** Сторінка оплати провайдера. Null, якщо рахунок ще не створено. */
  pageUrl: string | null;
}

/** Стан підключення еквайрингу викладача. Токен сюди не потрапляє ніколи. */
export interface PaymentConnection {
  connected: boolean;
  provider: 'monobank' | null;
  connectedAt: string | null;
  /** Кілька останніх символів токена — лише щоб упізнати, який саме підключено. */
  tokenHint: string | null;
  /** Чи є спільний токен розгортання, яким виставляються рахунки без підключення. */
  fallbackAvailable: boolean;
  /** Чи налаштоване шифрування на сервері. */
  canConnect: boolean;
}

/** Що змінив прохід переходів станів за часом. */
export interface MaintenanceResult {
  holdsExpired: number;
  lessonsCompleted: number;
  paymentsExpired: number;
}
