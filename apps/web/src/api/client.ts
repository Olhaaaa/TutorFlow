import type {
  AuditResult, AvailabilityRule, BookResult, CancelResult, GenerateResult,
  Enrollment, MaintenanceResult, PaymentConnection, PaymentView, SlotView,
  CalendarLink, ExternalBusy, RescheduleResult, Student, TeacherCancelResult,
  TeacherSlotView, TelegramState, TopupResult,
} from './types.js';

/**
 * Єдине місце, де визначається, як запрос повідомляє, хто його робить.
 * Решта застосунку про спосіб автентифікації не знає.
 */
export interface Session {
  token: string;
  role: 'student' | 'teacher';
  id: number;
  name: string;
  /** Зона з профілю, а не з браузера: розклад малюється в часі студента. */
  timezone: string;
}

const KEY = 'tutorflow.session';

export function loadSession(): Session | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Session;
    // timezone зʼявився пізніше за token: сесія без нього лишилась від старої
    // версії застосунку, і її простіше відкинути, ніж добирати зону окремо.
    return typeof v.token === 'string' && v.token.length > 0 && typeof v.timezone === 'string'
      ? v
      : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}

export class ApiError extends Error {
  readonly status: number;
  /**
   * Тіло відповіді цілком.
   *
   * Потрібне там, де сервер каже більше за одне речення: перелік причин, з
   * яких пароль не годиться, або скільки секунд чекати після 429. Текст для
   * людини збирається з цього на екрані, а не на сервері, бо саме екран знає
   * мову й місце, де показувати.
   */
  readonly payload: unknown;

  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  // content-type ставимо ЛИШЕ коли є тіло: Fastify відхиляє запрос, який
  // оголошує application/json і приходить порожнім
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!res.ok) {
    let message = `${res.status}`;
    let payload: unknown;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      payload = body;
      const m = body.message;
      message = Array.isArray(m) ? m.join('; ') : (m ?? message);
    } catch {
      /* тіло не JSON — лишаємо код */
    }
    throw new ApiError(res.status, message, payload);
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface Transaction {
  id: number; amountMinor: number; kind: string;
  slotId: number | null; comment: string | null; at: string;
}

/** Напрямок руху коштів у фільтрі історії. Дзеркало серверного типу. */
export type HistoryDirection = 'all' | 'in' | 'out';

export interface Balance {
  balanceMinor: number;
  dueMinor: number;
  unpaid: { slotId: number; startAt: string; priceMinor: number }[];
  history: Transaction[];
}

export const api = {
  login: (email: string, password: string) =>
    request<Session>('/auth/login', null, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  /* ---------- реєстрація й пароль ---------- */

  /**
   * Реєстрація викладача.
   *
   * Відповідь однакова і для вільної пошти, і для зайнятої — так задумано на
   * сервері, тому екран однаково показує «перевірте скриньку».
   */
  register: (input: {
    name: string; email: string; password: string; timezone: string; priceMinor?: number;
  }) => request<{ status: 'pending' }>('/auth/register', null, {
    method: 'POST',
    body: JSON.stringify(input),
  }),

  verifyEmail: (token: string) =>
    request<{ verified: true; email: string | null }>('/auth/verify-email', null, {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  resendVerification: (email: string) =>
    request<{ status: 'sent' }>('/auth/verify-email/resend', null, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  forgotPassword: (email: string) =>
    request<{ status: 'sent' }>('/auth/password/forgot', null, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, password: string) =>
    request<{ status: 'changed' }>('/auth/password/reset', null, {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),

  /** Зміна пароля в кабінеті. Поточний обовʼязковий — див. AuthService. */
  changePassword: (t: string, currentPassword: string, newPassword: string) =>
    request<{ status: 'changed' }>('/me/password', t, {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  /** Зміна власного часового поясу. Доступна обом ролям. */
  updateTimezone: (t: string, timezone: string) =>
    request<{ id: number; role: Session['role']; name: string; timezone: string }>(
      '/me/timezone',
      t,
      { method: 'PATCH', body: JSON.stringify({ timezone }) },
    ),

  slots: (t: string, from: Date, to: Date) =>
    request<SlotView[]>(`/slots?from=${from.toISOString()}&to=${to.toISOString()}`, t),

  book: (t: string, slotId: number) =>
    request<BookResult>(`/slots/${slotId}/book`, t, { method: 'POST' }),

  cancel: (t: string, slotId: number) =>
    request<CancelResult>(`/slots/${slotId}/cancel`, t, { method: 'POST' }),

  /**
   * Перенос — ОДИН запрос, а не скасування плюс бронювання: між двома
   * викликами місце встигають забрати.
   */
  reschedule: (t: string, slotId: number, toSlotId: number) =>
    request<RescheduleResult>(`/slots/${slotId}/reschedule`, t, {
      method: 'POST',
      body: JSON.stringify({ toSlotId }),
    }),

  balance: (t: string) => request<Balance>('/balance', t),

  /**
   * Історія з фільтром напрямку. Окремий запрос, а не фільтрація вже
   * отриманого `balance.history`: вікно на сервері обмежене, і поповнення
   * може не потрапити до нього взагалі — тоді фільтрувати локально нічого.
   */
  history: (t: string, direction: HistoryDirection) =>
    request<Transaction[]>(`/balance/history?direction=${direction}`, t),

  /**
   * Оплата карткою. Баланс змінює НЕ ця пара маршрутів, а вебхук провайдера:
   * клієнт лише створює рахунок і потім питає, чим усе скінчилось.
   */
  payments: {
    create: (t: string, amountMinor: number) =>
      request<PaymentView>('/payments', t, {
        method: 'POST',
        body: JSON.stringify({ amountMinor }),
      }),

    status: (t: string, id: number) => request<PaymentView>(`/payments/${id}`, t),

    /** Чи підключив викладач цього студента приймання оплати. */
    options: (t: string) => request<{ enabled: boolean }>('/payments/options', t),
  },

  /**
   * Стрічка `.ics` студента: своя адреса зі своїм секретом, а не спільна з
   * викладачем. GET її ж і створює при першому зверненні.
   */
  calendarLink: (t: string) => request<CalendarLink>('/student/calendar-link', t),

  revokeCalendarLink: (t: string) =>
    request<{ revoked: boolean }>('/student/calendar-link', t, { method: 'DELETE' }),

  /** Канал нагадувань. Привʼязка чату — дія студента над власним профілем. */
  telegram: {
    state: (t: string) => request<TelegramState>('/me/telegram', t),
    unlink: (t: string) => request<TelegramState>('/me/telegram', t, { method: 'DELETE' }),
  },

  /** Маршрути кабінету викладача. Усі вимагають токен із роллю teacher. */
  teacher: {
    slots: (t: string, from: Date, to: Date) =>
      request<TeacherSlotView[]>(
        `/teacher/slots?from=${from.toISOString()}&to=${to.toISOString()}`,
        t,
      ),

    /**
     * Скасувати заняття. Правило інше, ніж у студента, тому й маршрут інший:
     * година звільняється завжди, а оплачене заняття завжди повертає кошти.
     */
    cancel: (t: string, slotId: number) =>
      request<TeacherCancelResult>(`/teacher/slots/${slotId}/cancel`, t, { method: 'POST' }),

    students: (t: string) => request<Student[]>('/teacher/students', t),

    topup: (t: string, studentId: number, amountMinor: number, comment?: string) =>
      request<TopupResult>(`/teacher/students/${studentId}/topup`, t, {
        method: 'POST',
        body: JSON.stringify({ amountMinor, comment }),
      }),

    audit: (t: string, studentId: number) =>
      request<AuditResult>(`/teacher/students/${studentId}/audit`, t),

    addStudent: (
      t: string,
      s: { name: string; email: string; timezone: string; password: string },
    ) =>
      request<Student>('/teacher/students', t, { method: 'POST', body: JSON.stringify(s) }),

    availability: (t: string) => request<AvailabilityRule[]>('/teacher/availability', t),

    /** Зайнятість поза розкладом: та сама межа, що й інтеграція з чужим календарем. */
    busy: (t: string, from: Date, to: Date) =>
      request<ExternalBusy[]>(
        `/teacher/busy?from=${from.toISOString()}&to=${to.toISOString()}`,
        t,
      ),

    addBusy: (
      t: string,
      b: { startAt: string; endAt: string; title?: string },
    ) =>
      request<ExternalBusy>('/teacher/busy', t, { method: 'POST', body: JSON.stringify(b) }),

    removeBusy: (t: string, id: number) =>
      request<{ id: number }>(`/teacher/busy/${id}`, t, { method: 'DELETE' }),

    calendarLink: (t: string) => request<CalendarLink>('/teacher/calendar-link', t),

    revokeCalendarLink: (t: string) =>
      request<{ revoked: boolean }>('/teacher/calendar-link', t, { method: 'DELETE' }),

    enrollments: (t: string) => request<Enrollment[]>('/teacher/enrollments', t),

    enroll: (
      t: string,
      e: { studentId: number; weekday: number; startTime: string },
    ) =>
      request<{ id: number; slotsHeld: number }>('/teacher/enrollments', t, {
        method: 'POST',
        body: JSON.stringify(e),
      }),

    unenroll: (t: string, id: number) =>
      request<{ id: number; slotsReleased: number }>(`/teacher/enrollments/${id}`, t, {
        method: 'DELETE',
      }),

    setAvailability: (
      t: string,
      r: { weekday: number; startTime: string; durationMin: number; priceMinor: number },
    ) =>
      request<AvailabilityRule>('/teacher/availability', t, {
        method: 'POST',
        body: JSON.stringify(r),
      }),

    /** Прибрати годину: майбутні вільні слоти цієї години зникають разом із нею. */
    removeAvailability: (t: string, id: number) =>
      request<{ id: number; slotsRemoved: number }>(`/teacher/availability/${id}`, t, {
        method: 'DELETE',
      }),

    paymentConnection: (t: string) =>
      request<PaymentConnection>('/payments/teacher/connection', t),

    connectPayments: (t: string, token: string) =>
      request<PaymentConnection>('/payments/teacher/connection', t, {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),

    disconnectPayments: (t: string) =>
      request<PaymentConnection>('/payments/teacher/connection', t, { method: 'DELETE' }),

    /** Застосувати переходи станів, час яких уже настав. */
    maintenance: (t: string) =>
      request<MaintenanceResult>('/teacher/maintenance', t, { method: 'POST' }),

    generate: (t: string, weeks: number) =>
      request<GenerateResult>('/teacher/slots:generate', t, {
        method: 'POST',
        body: JSON.stringify({ weeks }),
      }),
  },
};
