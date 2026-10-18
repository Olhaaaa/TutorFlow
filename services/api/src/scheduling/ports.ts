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

/**
 * ДРУГА МЕЖА МІЖ МОДУЛЯМИ, і вона дивиться в той самий бік, що й ChargePort:
 * оголошена розкладом, реалізується білінгом.
 *
 * Розкладу потрібні від студента три речі, і жодна з них не є його даними.
 * Перша — імʼя: власний розклад викладача підписаний людьми, а не номерами.
 * Друга — секретний токен стрічки `.ics`: він лежить у `students`, бо
 * відкликати свою адресу студент мусить уміти сам. Третя — хто власник
 * пред'явленого токена.
 *
 * Доки це був прямий виклик `StudentsRepository`, розклад читав чужу таблицю
 * й тягнув її в `join` усередині SQL. Саме цей `join` і неможливо виконати,
 * коли в кожного сервіса власна база, — тому межа названа портом ще в
 * моноліті, де вона нічого не коштує.
 *
 * Транзакції тут немає навмисно: усі три операції — довідкові, і виконувати
 * їх у транзакції зміни слота не потрібно. Через це той самий інтерфейс
 * реалізується і викликом у памʼяті, і запросом по HTTP.
 */
export interface StudentDirectoryPort {
  /** Імена студентів за ідентифікаторами. Пакетом, бо йдуть вони екраном. */
  namesByIds(ids: readonly number[]): Promise<Map<number, string>>;

  /**
   * Токен стрічки студента. Створюється при першому зверненні й далі не
   * змінюється: адресу вже вставлено в чужу календарну програму.
   *
   * Сам токен генерує реалізація, а не розклад: таблиця `students` належить
   * білінгу, і вирішувати, що в ній лежить, мусить він.
   */
  ensureCalendarToken(
    studentId: number,
  ): Promise<{ id: number; name: string; timezone: string; calendarToken: string } | null>;

  /** Відкликати стрічку: стара адреса перестає працювати негайно. */
  clearCalendarToken(studentId: number): Promise<void>;

  /** Хто власник цієї стрічки. Єдиний спосіб автентифікації для `.ics`. */
  byCalendarToken(
    token: string,
  ): Promise<{ id: number; teacherId: number; name: string; timezone: string } | null>;
}

export const STUDENT_DIRECTORY = 'STUDENT_DIRECTORY';
