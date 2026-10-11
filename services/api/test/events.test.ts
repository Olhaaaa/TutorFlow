/**
 * Виконувана специфікація подій. Бази й Redis не потребує: і ключ
 * дедуплікації, і текст нагадування — чисті функції, і саме тому їх можна
 * перевірити раніше, ніж підніметься будь-яка інфраструктура.
 */
import { describe, expect, it } from 'vitest';
import {
  dedupKey, renderNotification, type DomainEvent,
} from '../src/events/events.js';

const credited: DomainEvent = {
  type: 'payment.credited',
  paymentId: 7,
  studentId: 3,
  amountMinor: 100_000,
  balanceMinor: 50_000,
  convertedSlots: [150],
};

const cancelled: DomainEvent = {
  type: 'lesson.cancelled_by_teacher',
  slotId: 82,
  studentId: 2,
  startAt: '2026-10-13T11:00:00.000Z',
  refundedMinor: 50_000,
};

describe('ключ дедуплікації', () => {
  it('будується з факту в нашій базі, а не з ідентифікатора повідомлення', () => {
    expect(dedupKey(credited)).toBe('payment.credited:7');
    expect(dedupKey(cancelled)).toBe('lesson.cancelled_by_teacher:82');
  });

  it('той самий факт дає той самий ключ при повторній доставці', () => {
    // та сама подія, інший екземпляр обʼєкта — ключ мусить зійтись
    expect(dedupKey({ ...credited })).toBe(dedupKey(credited));
  });

  it('різні факти одного типу не злипаються', () => {
    expect(dedupKey({ ...credited, paymentId: 8 })).not.toBe(dedupKey(credited));
  });

  it('події різних типів не можуть зіткнутись ключами', () => {
    // навмисно той самий номер: 82-й платіж і 82-й слот — різні факти
    expect(dedupKey({ ...credited, paymentId: 82 })).not.toBe(dedupKey(cancelled));
  });
});

describe('текст нагадування', () => {
  it('зарахування: сума, закриті заняття й залишок', () => {
    const n = renderNotification(credited);
    expect(n.studentId).toBe(3);
    expect(n.kind).toBe('payment.credited');
    expect(n.text).toBe('Зараховано 1000 ₴. Закрито занять: 1. На балансі 500 ₴.');
  });

  it('зарахування без закритих занять не згадує їх зовсім', () => {
    const n = renderNotification({ ...credited, convertedSlots: [] });
    expect(n.text).toBe('Зараховано 1000 ₴. На балансі 500 ₴.');
  });

  it('скасування оплаченого заняття називає суму повернення', () => {
    expect(renderNotification(cancelled).text).toContain('500 ₴ повернуто на баланс');
  });

  it('скасування неоплаченого не обіцяє повернення', () => {
    const n = renderNotification({ ...cancelled, refundedMinor: 0 });
    expect(n.text).toContain('не було оплачене');
    expect(n.text).not.toContain('повернуто');
  });

  it('час заняття у текст не підставляється: зона живе в профілі студента', () => {
    expect(renderNotification(cancelled).text).not.toContain('11:00');
  });
});
