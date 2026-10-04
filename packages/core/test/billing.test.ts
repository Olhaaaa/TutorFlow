/**
 * Виконувана специфікація правил білінгу.
 * Ці тести падають доки src/rules/billing.ts не реалізований. Так і задумано.
 */
import { describe, it, expect } from 'vitest';
import { minor } from '../src/money.js';
import {
  isAffordable, slotsCoveredBy, chargeAmount,
  refundAmount, balanceFrom, shortfall,
} from '../src/rules/billing.js';

const UAH = (n: number) => minor(n * 100);

describe('правило 2 — чи вистачає коштів', () => {
  it('рівно на ціну — вистачає', () => {
    expect(isAffordable(UAH(500), UAH(500))).toBe(true);
  });

  it('на копійку менше — не вистачає', () => {
    expect(isAffordable(minor(49999), UAH(500))).toBe(false);
  });

  it('відʼємний баланс не покриває нічого', () => {
    expect(isAffordable(minor(-1), UAH(500))).toBe(false);
  });
});

describe('правило 4 — застосування платежу', () => {
  const prices = [UAH(500), UAH(500), UAH(500), UAH(500)];

  it('оплата трьох занять закриває рівно три найближчі', () => {
    expect(slotsCoveredBy(UAH(1500), prices)).toBe(3);
  });

  it('нуля не вистачає ні на що', () => {
    expect(slotsCoveredBy(UAH(0), prices)).toBe(0);
  });

  it('надлишку вистачає на всі', () => {
    expect(slotsCoveredBy(UAH(9000), prices)).toBe(4);
  });

  it('зупиняється на першому, на який не вистачило, і не перестрибує дешевший', () => {
    // 700 грн: перший за 500 закривається, на другий за 900 не вистачає,
    // третій за 100 НЕ має закритись, бо порядок хронологічний
    expect(slotsCoveredBy(UAH(700), [UAH(500), UAH(900), UAH(100)])).toBe(1);
  });

  it('порожній список дає нуль', () => {
    expect(slotsCoveredBy(UAH(1000), [])).toBe(0);
  });
});

describe('суми транзакцій', () => {
  it('списання відʼємне, повернення додатне', () => {
    expect(chargeAmount(UAH(500))).toBe(-50000);
    expect(refundAmount(UAH(500))).toBe(50000);
  });

  it('баланс — це сума транзакцій', () => {
    expect(balanceFrom([
      { amountMinor: UAH(2000) },
      { amountMinor: chargeAmount(UAH(500)) },
      { amountMinor: chargeAmount(UAH(500)) },
      { amountMinor: refundAmount(UAH(500)) },
    ])).toBe(150000);
  });

  it('без транзакцій баланс нульовий', () => {
    expect(balanceFrom([])).toBe(0);
  });
});

describe('нагадування про оплату', () => {
  it('скільки не вистачає на всі неоплачені', () => {
    expect(shortfall(UAH(500), [UAH(500), UAH(500)])).toBe(50000);
  });

  it('якщо вистачає — нуль, а не відʼємне', () => {
    expect(shortfall(UAH(2000), [UAH(500), UAH(500)])).toBe(0);
  });

  it('відʼємний баланс враховується повністю', () => {
    expect(shortfall(minor(-10000), [UAH(500)])).toBe(60000);
  });
});
