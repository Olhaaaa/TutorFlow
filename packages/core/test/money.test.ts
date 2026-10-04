import { describe, it, expect } from 'vitest';
import { minor, add, sub, negate, format, ZERO } from '../src/money.js';

describe('гроші — цілі копійки', () => {
  it('приймає цілі значення', () => {
    expect(minor(50000)).toBe(50000);
    expect(minor(0)).toBe(0);
    expect(minor(-50000)).toBe(-50000);
  });

  it('падає на нецілому значенні', () => {
    expect(() => minor(500.5)).toThrow(RangeError);
    expect(() => minor(0.1 + 0.2)).toThrow(RangeError);
  });

  it('падає поза межею безпечних цілих', () => {
    expect(() => minor(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });

  it('арифметика лишається цілою', () => {
    expect(add(minor(50000), minor(25000))).toBe(75000);
    expect(sub(minor(50000), minor(75000))).toBe(-25000);
    expect(negate(minor(50000))).toBe(-50000);
    expect(add(ZERO, minor(1))).toBe(1);
  });

  it('форматує з двома знаками', () => {
    expect(format(minor(50000))).toBe('500.00 UAH');
    expect(format(minor(50050))).toBe('500.50 UAH');
    expect(format(minor(5))).toBe('0.05 UAH');
    expect(format(minor(-50000))).toBe('-500.00 UAH');
  });
});
