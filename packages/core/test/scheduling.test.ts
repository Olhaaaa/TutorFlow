/**
 * Виконувана специфікація правил розкладу.
 * Ці тести падають доки src/rules/scheduling.ts не реалізований. Так і задумано.
 */
import { describe, it, expect } from 'vitest';
import {
  bookRejection, holdDeadline, isHoldExpired,
  cancelOutcome, isCancellationFree, isCompleted, teacherCancelOutcome,
  reminderWindow, REMINDER_LEAD_HOURS,
} from '../src/rules/scheduling.js';

const NOW = new Date('2026-10-14T12:00:00Z');
const h = (n: number) => new Date(NOW.getTime() + n * 3600_000);

describe('правило 2 — разове бронювання', () => {
  it('вільний слот у майбутньому взяти можна', () => {
    expect(bookRejection({ status: 'free', startAt: h(24) }, NOW)).toBeNull();
  });

  it('слот у минулому взяти не можна', () => {
    expect(bookRejection({ status: 'free', startAt: h(-1) }, NOW)).toBe('in_the_past');
  });

  it('зайнятий слот взяти не можна', () => {
    expect(bookRejection({ status: 'booked', startAt: h(24) }, NOW)).toBe('not_free');
    expect(bookRejection({ status: 'pre_booked', startAt: h(24) }, NOW)).toBe('not_free');
    expect(bookRejection({ status: 'done', startAt: h(24) }, NOW)).toBe('not_free');
  });
});

describe('правило 5 — дедлайн оплати', () => {
  it('дедлайн — це початок мінус paymentDeadlineHours', () => {
    expect(holdDeadline(new Date('2026-10-20T16:00:00Z'), 24))
      .toEqual(new Date('2026-10-19T16:00:00Z'));
    expect(holdDeadline(new Date('2026-10-20T16:00:00Z'), 2))
      .toEqual(new Date('2026-10-20T14:00:00Z'));
  });

  it('спливлий hold видно', () => {
    expect(isHoldExpired({ status: 'pre_booked', holdExpiresAt: h(-1) }, NOW)).toBe(true);
    expect(isHoldExpired({ status: 'pre_booked', holdExpiresAt: h(1) }, NOW)).toBe(false);
  });

  it('слот без holdExpiresAt не вважається спливлим', () => {
    expect(isHoldExpired({ status: 'booked', holdExpiresAt: null }, NOW)).toBe(false);
    expect(isHoldExpired({ status: 'free', holdExpiresAt: null }, NOW)).toBe(false);
  });
});

describe('правила 6 і 7 — скасування', () => {
  it('pre_booked скасовується безкоштовно навіть за годину до початку', () => {
    const slot = { status: 'pre_booked' as const, startAt: h(1) };
    expect(cancelOutcome(slot, NOW, 24)).toBe('free');
    expect(isCancellationFree(slot, NOW, 24)).toBe(true);
  });

  it('booked за 48 годин — безкоштовно, слот знову вільний', () => {
    const slot = { status: 'booked' as const, startAt: h(48) };
    expect(cancelOutcome(slot, NOW, 24)).toBe('free');
    expect(isCancellationFree(slot, NOW, 24)).toBe(true);
  });

  it('booked рівно за 24 години — ще безкоштовно', () => {
    const slot = { status: 'booked' as const, startAt: h(24) };
    expect(cancelOutcome(slot, NOW, 24)).toBe('free');
  });

  it('booked за 2 години — гроші лишаються викладачу', () => {
    const slot = { status: 'booked' as const, startAt: h(2) };
    expect(cancelOutcome(slot, NOW, 24)).toBe('cancelled_late');
    expect(isCancellationFree(slot, NOW, 24)).toBe(false);
  });

  it('скасовувати нічого, якщо слот вільний або вже закритий', () => {
    expect(() => cancelOutcome({ status: 'free', startAt: h(24) }, NOW, 24)).toThrow();
    expect(() => cancelOutcome({ status: 'done', startAt: h(-24) }, NOW, 24)).toThrow();
    expect(() => cancelOutcome({ status: 'cancelled_late', startAt: h(-1) }, NOW, 24)).toThrow();
  });
});

describe('правило 8 — завершення', () => {
  it('booked із минулим кінцем пора закрити', () => {
    expect(isCompleted({ status: 'booked', endAt: h(-1) }, NOW)).toBe(true);
  });

  it('booked, що ще не закінчився, не закривається', () => {
    expect(isCompleted({ status: 'booked', endAt: h(1) }, NOW)).toBe(false);
  });

  it('неоплачений і вільний слоти не закриваються, навіть якщо час минув', () => {
    expect(isCompleted({ status: 'pre_booked', endAt: h(-1) }, NOW)).toBe(false);
    expect(isCompleted({ status: 'free', endAt: h(-1) }, NOW)).toBe(false);
    expect(isCompleted({ status: 'done', endAt: h(-1) }, NOW)).toBe(false);
  });
});

describe('скасування викладачем', () => {
  it('оплачене заняття: година звільняється, кошти повертаються', () => {
    expect(teacherCancelOutcome({ status: 'booked', startAt: h(48) }, NOW))
      .toEqual({ status: 'free', refund: true });
  });

  it('правило cancelHours на викладача не діє: за годину до початку те саме', () => {
    expect(teacherCancelOutcome({ status: 'booked', startAt: h(1) }, NOW))
      .toEqual({ status: 'free', refund: true });
  });

  it('неоплачене закріплення звільняється, але повертати нічого', () => {
    expect(teacherCancelOutcome({ status: 'pre_booked', startAt: h(1) }, NOW))
      .toEqual({ status: 'free', refund: false });
  });

  it('cancelled_late у викладача не виникає ніколи', () => {
    for (const at of [h(0.5), h(1), h(24), h(100)]) {
      expect(teacherCancelOutcome({ status: 'booked', startAt: at }, NOW).status).toBe('free');
    }
  });

  it('вільний або вже закритий слот скасувати не можна', () => {
    expect(() => teacherCancelOutcome({ status: 'free', startAt: h(24) }, NOW)).toThrow();
    expect(() => teacherCancelOutcome({ status: 'done', startAt: h(-24) }, NOW)).toThrow();
    expect(() => teacherCancelOutcome({ status: 'cancelled_late', startAt: h(-1) }, NOW)).toThrow();
  });

  it('заняття, яке вже почалось, скасувати не можна', () => {
    expect(() => teacherCancelOutcome({ status: 'booked', startAt: h(-0.5) }, NOW)).toThrow();
    expect(() => teacherCancelOutcome({ status: 'booked', startAt: NOW }, NOW)).toThrow();
  });
});

describe('вікно нагадувань', () => {
  it('дивиться на добу вперед', () => {
    const w = reminderWindow(NOW, 0);
    expect(w.to).toEqual(h(REMINDER_LEAD_HOURS));
    expect(w.from).toEqual(h(REMINDER_LEAD_HOURS));
  });

  it('запас назад розширює вікно, а не зсуває його', () => {
    const w = reminderWindow(NOW, 15);
    expect(w.to).toEqual(h(24));
    expect(w.from).toEqual(new Date(h(24).getTime() - 15 * 60_000));
  });

  it('заняття, до якого рівно доба, у вікно потрапляє', () => {
    const w = reminderWindow(NOW, 15);
    const lesson = h(24);
    expect(lesson >= w.from && lesson <= w.to).toBe(true);
  });

  it('заняття через тиждень і заняття через годину — ні', () => {
    const w = reminderWindow(NOW, 15);
    for (const at of [h(24 * 7), h(1), h(-1)]) {
      expect(at >= w.from && at <= w.to).toBe(false);
    }
  });

  it('вікно рухається разом із now, тому сусідні проходи перекриваються запасом', () => {
    const later = new Date(NOW.getTime() + 5 * 60_000);
    const a = reminderWindow(NOW, 15);
    const b = reminderWindow(later, 15);
    expect(b.from < a.to).toBe(true);
  });
});
