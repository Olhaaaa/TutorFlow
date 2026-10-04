/**
 * Гроші в системі — ЦІЛІ числа копійок, ніколи не float.
 *
 * У TypeScript `number` це float64, тому один випадковий поділ перетворює
 * баланс на 0.30000000000000004. Брендований тип не дає передати в грошову
 * функцію звичайне число, не пройшовши через `minor()`, а `minor()` падає
 * на нецілому значенні.
 *
 * Межа безпеки — 2^53 копійок, тобто близько 90 трильйонів гривень.
 */
export type Minor = number & { readonly __brand: 'minor' };

export function minor(value: number): Minor {
  if (!Number.isInteger(value)) {
    throw new RangeError(`гроші мусять бути цілими копійками, отримано ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`значення поза межею безпечних цілих: ${value}`);
  }
  return value as Minor;
}

export const ZERO: Minor = 0 as Minor;

export function add(a: Minor, b: Minor): Minor {
  return minor(a + b);
}

export function sub(a: Minor, b: Minor): Minor {
  return minor(a - b);
}

export function negate(a: Minor): Minor {
  return minor(-a);
}

/**
 * Ділення на грошах заборонене навмисно: воно дає нецілий результат і є
 * найчастішим джерелом розʼїзду балансів. Якщо колись знадобиться частка —
 * беріть `Math.trunc` явно й пропускайте результат через `minor()`.
 */
export function format(value: Minor, currency = 'UAH'): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')} ${currency}`;
}
