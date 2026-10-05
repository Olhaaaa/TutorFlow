/**
 * Чисті правила білінгу.
 *
 * Жодних імпортів із @nestjs/*, жодного доступу до БД. Усі суми — `Minor`,
 * тобто цілі копійки. Ділення на грошах не застосовується.
 */
import { minor, type Minor } from '../money.js';
import type { Transaction } from '../types.js';

/**
 * Чи достатньо балансу, щоб слот одразу став `booked`.
 * Боргу в моделі немає: не вистачає коштів — слот лишається `pre_booked`.
 */
export function isAffordable(balance: Minor, price: Minor): boolean {
  return balance >= price;
}

/**
 * Скільки найближчих `pre_booked` слотів покриває баланс.
 *
 * `prices` подається В ХРОНОЛОГІЧНОМУ ПОРЯДКУ. Рахується найдовший ПРЕФІКС,
 * який вкладається в баланс: на першому слоті, якого не вистачило, підрахунок
 * спиняється й дешевший наступний НЕ «перестрибується».
 *
 * Оплатив чотири заняття — закрились чотири найближчі, саме цього очікує
 * студент. Жадібний вибір за ціною здавався б вигіднішим, але давав би
 * непередбачуваний для людини результат.
 */
export function slotsCoveredBy(balance: Minor, prices: readonly Minor[]): number {
  let left: number = balance;
  let covered = 0;

  for (const price of prices) {
    if (left < price) break;
    left -= price;
    covered += 1;
  }

  return covered;
}

/** Сума транзакції списання за заняття: відʼємна, на величину ціни. */
export function chargeAmount(price: Minor): Minor {
  return minor(-price);
}

/** Сума транзакції повернення: додатна, на величину ціни. */
export function refundAmount(price: Minor): Minor {
  return minor(price);
}

/**
 * Баланс як сума всіх транзакцій. Транзакції — джерело істини,
 * `students.balance_minor` лише кеш, і ця функція дозволяє його перевірити.
 */
export function balanceFrom(
  transactions: readonly Pick<Transaction, 'amountMinor'>[],
): Minor {
  return minor(transactions.reduce((sum, t) => sum + t.amountMinor, 0));
}

/**
 * Скільки не вистачає, щоб закрити перелічені неоплачені слоти.
 * Якщо вистачає — нуль, а не відʼємне число: це сума «до сплати», і
 * відʼємна сума до сплати сенсу не має.
 */
export function shortfall(balance: Minor, prices: readonly Minor[]): Minor {
  const total = prices.reduce<number>((sum, p) => sum + p, 0);
  return minor(Math.max(0, total - balance));
}
