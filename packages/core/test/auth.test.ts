/**
 * Правила входу: вимоги до пароля, строк життя кодів, обмеження частоти.
 *
 * Тест чистий — ні бази, ні HTTP. Саме тому межі тут перевіряються щільно:
 * помилка на одиницю у вікні обмеження не падає, а тихо пропускає зайву
 * спробу, і побачити її можна лише так.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeEmail,
  passwordIssues,
  PASSWORD_MIN_LENGTH,
  THROTTLE,
  throttleDecision,
  tokenExpiry,
  isTokenUsable,
} from '../src/rules/auth.js';

const NOW = new Date('2026-10-20T12:00:00Z');

describe('вимоги до пароля', () => {
  it('довга фраза проходить без зауважень', () => {
    expect(passwordIssues('кава з молоком о сьомій')).toEqual([]);
  });

  it('коротший за мінімум — не проходить', () => {
    expect(passwordIssues('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toContain('too_short');
    expect(passwordIssues('b'.repeat(PASSWORD_MIN_LENGTH))).not.toContain('too_short');
  });

  it('довжина рахується в БАЙТАХ для верхньої межі: кирилиця важча', () => {
    // 40 кириличних символів — це 80 байтів, а bcrypt читає лише 72
    expect(passwordIssues('я'.repeat(40))).toContain('too_long');
    expect(passwordIssues('я'.repeat(30))).not.toContain('too_long');
  });

  it('самі пробіли — це не пароль', () => {
    expect(passwordIssues('            ')).toEqual(['whitespace_only']);
  });

  it('власна пошта як пароль відхиляється', () => {
    expect(passwordIssues('olha@tutorflow.local')).toContain('looks_like_email');
  });

  it('один символ підряд не рятує навіть довжиною', () => {
    expect(passwordIssues('aaaaaaaaaaaaaaaa')).toContain('repeats_one_character');
  });
});

describe('строк життя кодів', () => {
  it('підтвердження пошти живе добу, відновлення пароля — годину', () => {
    expect(tokenExpiry('verify_email', NOW).toISOString()).toBe('2026-10-21T12:00:00.000Z');
    expect(tokenExpiry('reset_password', NOW).toISOString()).toBe('2026-10-20T13:00:00.000Z');
  });

  it('використаний код не годиться, навіть якщо не прострочений', () => {
    const expiresAt = new Date('2026-10-20T13:00:00Z');
    expect(isTokenUsable({ expiresAt, usedAt: null }, NOW)).toBe(true);
    expect(isTokenUsable({ expiresAt, usedAt: NOW }, NOW)).toBe(false);
  });

  it('прострочений код не годиться: межа — строго більше', () => {
    const expiresAt = new Date(NOW);
    expect(isTokenUsable({ expiresAt, usedAt: null }, NOW)).toBe(false);
  });
});

describe('обмеження частоти', () => {
  const policy = THROTTLE.send_email;

  it('перша спроба починає вікно', () => {
    const d = throttleDecision(null, policy, NOW);
    expect(d.allowed).toBe(true);
    expect(d.next).toEqual({ attempts: 1, windowStarts: NOW });
  });

  it('спроби в межах ліміту дозволені, наступна — ні', () => {
    let state = { attempts: policy.attempts - 1, windowStarts: NOW };
    const last = throttleDecision(state, policy, new Date(NOW.getTime() + 60_000));
    expect(last.allowed).toBe(true);

    state = { attempts: policy.attempts, windowStarts: NOW };
    const over = throttleDecision(state, policy, new Date(NOW.getTime() + 60_000));
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSeconds).toBe(policy.windowMinutes * 60 - 60);
  });

  it('після вікна лічильник починається заново', () => {
    const state = { attempts: 99, windowStarts: NOW };
    const after = new Date(NOW.getTime() + policy.windowMinutes * 60_000);
    const d = throttleDecision(state, policy, after);
    expect(d.allowed).toBe(true);
    expect(d.next).toEqual({ attempts: 1, windowStarts: after });
  });

  it('вхід обмежений мʼякше за розсилання листів', () => {
    expect(THROTTLE.login.attempts).toBeGreaterThan(THROTTLE.send_email.attempts);
  });
});

describe('канонічна пошта', () => {
  it('регістр і пробіли не створюють другого акаунта', () => {
    expect(normalizeEmail('  Olha@Mail.UA ')).toBe('olha@mail.ua');
  });
});
