/**
 * Код привʼязки чату. Бази й мережі не потребує: це рівно та частина каналу,
 * яку можна описати як правило.
 */
import { describe, expect, it } from 'vitest';
import { newLinkCode, parseLinkCode } from '../src/telegram/link-code.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

describe('новий код', () => {
  it('вісім символів з алфавіту без двозначних пар', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = newLinkCode();
      expect(code).toHaveLength(8);
      for (const ch of code) expect(ALPHABET).toContain(ch);
    }
  });

  it('не містить символів, які неможливо продиктувати', () => {
    const codes = Array.from({ length: 200 }, () => newLinkCode()).join('');
    for (const ambiguous of ['0', 'O', '1', 'I', 'L']) {
      expect(codes).not.toContain(ambiguous);
    }
  });

  it('двісті кодів поспіль не повторюються', () => {
    const codes = new Set(Array.from({ length: 200 }, () => newLinkCode()));
    expect(codes.size).toBe(200);
  });
});

describe('розбір того, що студент надіслав боту', () => {
  const code = 'ABCD2345';

  it('код як є', () => {
    expect(parseLinkCode(code)).toBe(code);
  });

  it('команда з посилання t.me/бот?start=КОД', () => {
    expect(parseLinkCode(`/start ${code}`)).toBe(code);
    expect(parseLinkCode(`/START ${code}`)).toBe(code);
  });

  it('малі літери, пробіли й дефіси всередині', () => {
    expect(parseLinkCode('abcd2345')).toBe(code);
    expect(parseLinkCode('  abcd 2345 ')).toBe(code);
    expect(parseLinkCode('ABCD-2345')).toBe(code);
  });

  it('не код — це null, а не виняток', () => {
    expect(parseLinkCode(undefined)).toBeNull();
    expect(parseLinkCode('')).toBeNull();
    expect(parseLinkCode('привіт')).toBeNull();
    expect(parseLinkCode('/start')).toBeNull();
    expect(parseLinkCode('ABCD234')).toBeNull();       // закоротко
    expect(parseLinkCode('ABCD23456')).toBeNull();     // задовго
    expect(parseLinkCode('ABCD234O')).toBeNull();      // символ поза алфавітом
  });
});
