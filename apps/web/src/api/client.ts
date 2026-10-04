import type { BookResult, CancelResult, SlotView } from './types.js';

/**
 * Єдине місце, де визначається, як запрос повідомляє, хто його робить.
 *
 * Зараз це заголовки, які приймає сервер у не-продакшн оточенні. Коли
 * зʼявиться справжній вхід, тут зміниться лише authHeaders — решта застосунку
 * про спосіб автентифікації не знає.
 */
export interface Identity {
  studentId: number;
  teacherId: number;
}

const KEY = 'tutorflow.identity';

export function loadIdentity(): Identity | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Identity;
    return Number.isInteger(v.studentId) && Number.isInteger(v.teacherId) ? v : null;
  } catch {
    return null;
  }
}

export function saveIdentity(id: Identity): void {
  localStorage.setItem(KEY, JSON.stringify(id));
}

function authHeaders(id: Identity): Record<string, string> {
  return {
    'x-student-id': String(id.studentId),
    'x-teacher-id': String(id.teacherId),
  };
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  id: Identity,
  init: RequestInit = {},
): Promise<T> {
  // content-type ставимо ЛИШЕ коли є тіло: Fastify відхиляє запрос, який
  // оголошує application/json і приходить порожнім
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...authHeaders(id),
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

export const api = {
  slots: (id: Identity, from: Date, to: Date) =>
    request<SlotView[]>(
      `/slots?from=${from.toISOString()}&to=${to.toISOString()}`,
      id,
    ),

  book: (id: Identity, slotId: number) =>
    request<BookResult>(`/slots/${slotId}/book`, id, { method: 'POST' }),

  cancel: (id: Identity, slotId: number) =>
    request<CancelResult>(`/slots/${slotId}/cancel`, id, { method: 'POST' }),
};
