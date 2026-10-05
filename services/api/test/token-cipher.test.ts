/**
 * Шифрування платіжних токенів.
 *
 * Перевіряється не «чи шифрує», а дві властивості, заради яких узагалі обрано
 * AES-GCM: однаковий відкритий текст щоразу дає різний шифротекст, і будь-яка
 * підміна шифротексту виявляється, а не розшифровується в сміття.
 */
import { describe, expect, it } from 'vitest';
import { TokenCipher } from '../src/payments/token-cipher.js';

const cipher = new TokenCipher();
const TOKEN = 'uZtest_merchant_token_0123456789';

describe('TokenCipher', () => {
  it('шифрує й повертає той самий токен', () => {
    expect(cipher.decrypt(cipher.encrypt(TOKEN))).toBe(TOKEN);
  });

  it('двічі той самий токен дає різний шифротекст', () => {
    expect(cipher.encrypt(TOKEN)).not.toBe(cipher.encrypt(TOKEN));
  });

  it('підмінений шифротекст не розшифровується мовчки', () => {
    const [v, iv, tag, data] = cipher.encrypt(TOKEN).split(':');
    const broken = [v, iv, tag, `${data!.slice(0, -2)}AA`].join(':');
    expect(() => cipher.decrypt(broken)).toThrow();
  });

  it('формат із чужою версією відхиляється', () => {
    expect(() => cipher.decrypt('v2:a:b:c')).toThrow(/формат/);
  });

  it('підказка показує лише останні символи', () => {
    expect(TokenCipher.hint(TOKEN)).toBe('••••6789');
    expect(TokenCipher.hint('abc')).toBe('••••');
  });
});
