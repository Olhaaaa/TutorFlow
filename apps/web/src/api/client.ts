import type {
  AuditResult, AvailabilityRule, BookResult, CancelResult, GenerateResult,
  Enrollment, MaintenanceResult, PaymentConnection, PaymentView, SlotView,
  Student, TeacherCancelResult, TeacherSlotView, TopupResult,
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

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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
    try {
      const body = (await res.json()) as { message?: string | string[] };
      const m = body.message;
      message = Array.isArray(m) ? m.join('; ') : (m ?? message);
    } catch {
      /* тіло не JSON — лишаємо код */
    }
    throw new ApiError(res.status, message);
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface Balance {
  balanceMinor: number;
  dueMinor: number;
  unpaid: { slotId: number; startAt: string; priceMinor: number }[];
  history: {
    id: number; amountMinor: number; kind: string;
    slotId: number | null; comment: string | null; at: string;
  }[];
}

export const api = {
  login: (email: string, password: string) =>
    request<Session>('/auth/login', null, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
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

  balance: (t: string) => request<Balance>('/balance', t),

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
