import { NotImplementedException } from '@nestjs/common';
import type { Executor } from '../db/database.module.js';

/**
 * МЕЖА МІЖ МОДУЛЯМИ. Оголошена з боку розкладу, реалізується білінгом.
 *
 * Чому саме так: бронювання — одна транзакція з двох частин, захоплення слота
 * і списання коштів. Перша належить розкладу, друга — білінгу. Якби розклад викликав
 * білінг напряму, модулі зчепились би намертво.
 *
 * Усі методи приймають `tx`, бо мусять виконуватись у ТІЙ САМІЙ транзакції, що
 * й зміна слота. Інакше зʼявиться стан, де слот заброньований, а гроші не
 * списані. У лабораторній 3 саме ця транзакція зникне — сервіси матимуть
 * окремі бази, — і тут знадобиться outbox із компенсацією.
 */
export interface ChargePort {
  /** Поточний баланс студента в копійках. */
  balanceOf(tx: Executor, studentId: number): Promise<number>;

  /** Чи вистачає балансу студента, щоб слот одразу став `booked`. */
  isAffordable(tx: Executor, studentId: number, priceMinor: number): Promise<boolean>;

  /** Списати за заняття: транзакція `lesson_charge` і оновлення балансу. */
  chargeForLesson(tx: Executor, studentId: number, slotId: number, priceMinor: number): Promise<void>;

  /** Повернути кошти за вчасно скасоване заняття: транзакція `refund`. */
  refundForLesson(tx: Executor, studentId: number, slotId: number, priceMinor: number): Promise<void>;
}

export const CHARGE_PORT = 'CHARGE_PORT';

/**
 * Тимчасова реалізація-заглушка, доки модуль білінгу не постачив свою.
 * Дозволяє підняти застосунок і користуватись календарем, але бронювання
 * повертає 501. Прибрати разом із появою BillingModule.
 */
export class UnavailableChargeAdapter implements ChargePort {
  private fail(): never {
    throw new NotImplementedException(
      'білінг ще не підключений: очікується реалізація ChargePort із модуля білінгу',
    );
  }
  balanceOf(): Promise<number> { this.fail(); }
  isAffordable(): Promise<boolean> { this.fail(); }
  chargeForLesson(): Promise<void> { this.fail(); }
  refundForLesson(): Promise<void> { this.fail(); }
}
