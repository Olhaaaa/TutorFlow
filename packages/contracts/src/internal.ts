/**
 * Внутрішній API між сервісами.
 *
 * Це ті самі виклики, що в моноліті були викликами методів через порт. Тіла
 * описані тут, а не в кожному сервісі окремо, щоб сторона, яка кличе, і
 * сторона, яка відповідає, не розійшлись мовчки: тип один, і зламати його
 * можна тільки разом.
 *
 * Правило імен: поля в camelCase, бо це межа HTTP, а не схема бази. Суми — у
 * копійках і цілим числом, як усюди в проєкті.
 */

/** Заголовок, яким внутрішні маршрути відрізняють сусідній сервіс від світу. */
export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

/**
 * Код у тілі відповіді 409 на спробу списання, якої не покриває баланс.
 *
 * Потрібен саме код, а не текст: на цю відповідь сторона розкладу реагує
 * компенсацією — повертає слот у `pre_booked`, — і вирішувати це за текстом
 * повідомлення було б вгадуванням.
 */
export const INSUFFICIENT_FUNDS = 'insufficient_funds';

/* ---------- розклад → білінг ---------- */

/**
 * Рух коштів за заняттям.
 *
 * `opId` — ключ ІДЕМПОТЕНТНОСТІ, і він ключовий для всієї схеми: доставка
 * at-least-once означає, що те саме списання прийде двічі, а повторно
 * застосувати його не можна. Ключем не може бути слот: студент бронює й
 * скасовує ту саму годину по колу, і друге повернення за той самий слот —
 * законне. Тому ключ видає сторона, яка ініціює операцію, рівно один раз на
 * операцію.
 */
export interface MoneyTransfer {
  opId: string;
  studentId: number;
  slotId: number;
  /** Сума за заняття, завжди ДОДАТНА. Напрямок задає kind, а не знак. */
  amountMinor: number;
}

export interface TransferResult {
  /** false означає «це повтор, операція вже була застосована раніше». */
  applied: boolean;
  balanceMinor: number;
}

export interface BalanceResult {
  balanceMinor: number;
}

/** Імена студентів для розкладу викладача: у ньому заняття підписані людьми. */
export interface StudentNames {
  students: { id: number; name: string }[];
}

/**
 * Кому належить стрічка `.ics`. Токен лежить у `students`, а заняття — у
 * розкладі, тому стрічку збирає розклад, а власника за токеном шукає білінг.
 */
export interface StudentIdentity {
  id: number;
  teacherId: number;
  name: string;
  timezone: string;
}

/** Адреса стрічки, створена при першому зверненні. */
export interface StudentCalendarToken {
  id: number;
  name: string;
  timezone: string;
  calendarToken: string;
}

/* ---------- білінг → розклад ---------- */

/** Неоплачені заняття студента в хронологічному порядку. */
export interface PendingLessons {
  lessons: { slotId: number; startAt: string; priceMinor: number }[];
}

/** Що закрило зарахування коштів. Порожньо — грошей не вистачило на жодне. */
export interface ApplyPaymentResult {
  convertedSlots: number[];
}

/* ---------- вхід ---------- */

/** Запис, за яким сервіс входу перевіряє пароль. Хеш назовні не виходить. */
export interface CredentialRecord {
  id: number;
  role: 'teacher' | 'student';
  email: string;
  passwordHash: string;
  name: string;
  timezone: string;
  /** Для студента — його викладач; для викладача — він сам. */
  teacherId: number;
}

/** Профіль, яким сервіс входу наповнюється з інших сервісів. */
export interface CredentialUpsert {
  id: number;
  role: 'teacher' | 'student';
  email: string;
  passwordHash: string;
  name: string;
  timezone: string;
  teacherId: number;
}

/* ---------- нагадування ---------- */

/**
 * Контакт студента: кому й у якій зоні доставляти нагадування.
 *
 * Зона тут не для краси — текст нагадування будується в часі СТУДЕНТА, і без
 * неї канал доставки не може навіть написати, на котру годину заняття.
 */
export interface StudentContact {
  studentId: number;
  name: string;
  timezone: string;
  telegramChatId: number | null;
  telegramLinkCode: string | null;
}
