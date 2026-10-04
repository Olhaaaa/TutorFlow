/**
 * Чисті правила білінгу.
 *
 * Реалізувати так, щоб позеленіли test/billing.test.ts.
 *
 * Жодних імпортів із @nestjs/*, жодного доступу до БД. Усі суми — `Minor`.
 * Ділення на грошах не застосовується.
 */
import { type Minor } from '../money.js';
import type { Transaction } from '../types.js';

/**
 * Чи достатньо балансу, щоб слот одразу став `booked`.
 * Боргу в моделі немає: не вистачає коштів — слот лишається `pre_booked`.
 */
export function isAffordable(balance: Minor, price: Minor): boolean {
  throw new Error('не реалізовано: правила білінгу');
}

/**
 * Скільки найближчих `pre_booked` слотів покриває баланс.
 *
 * `prices` подається В ХРОНОЛОГІЧНОМУ ПОРЯДКУ. Функція рахує найдовший
 * ПРЕФІКС, який вкладається в баланс, і зупиняється на першому слоті, на
 * який не вистачило — не «перестрибує» його заради дешевшого наступного.
 * Оплатив чотири заняття — закрились чотири найближчі, саме цього очікує студент.
 */
export function slotsCoveredBy(balance: Minor, prices: readonly Minor[]): number {
  throw new Error('не реалізовано: правила білінгу');
}

/** Сума транзакції списання за заняття: відʼємна, на величину ціни. */
export function chargeAmount(price: Minor): Minor {
  throw new Error('не реалізовано: правила білінгу');
}

/** Сума транзакції повернення: додатна, на величину ціни. */
export function refundAmount(price: Minor): Minor {
  throw new Error('не реалізовано: правила білінгу');
}

/**
 * Баланс як сума всіх транзакцій. Транзакції — джерело істини,
 * `students.balance_minor` лише кеш, і ця функція його перевіряє.
 */
export function balanceFrom(transactions: readonly Pick<Transaction, 'amountMinor'>[]): Minor {
  throw new Error('не реалізовано: правила білінгу');
}

/** Скільки не вистачає, щоб закрити перелічені неоплачені слоти. Якщо вистачає — 0. */
export function shortfall(balance: Minor, prices: readonly Minor[]): Minor {
  throw new Error('не реалізовано: правила білінгу');
}
