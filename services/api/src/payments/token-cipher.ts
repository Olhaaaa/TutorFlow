import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { config } from '../config.js';

/**
 * Шифрування платіжних токенів для зберігання в базі.
 *
 * AES-256-GCM, а не просто AES: GCM дає ще й перевірку цілісності, тож
 * підмінений у базі шифротекст не розшифрується мовчки в сміття, а впаде.
 *
 * Формат рядка: `v1:<iv>:<tag>:<ciphertext>`, усе в base64url. Версія на
 * початку потрібна, щоб колись можна було перейти на інший алгоритм, не
 * ламаючи вже збережене.
 *
 * Ключ береться з окремої змінної оточення, а НЕ з JWT_SECRET: у них різні
 * терміни життя й різна ціна витоку. Токен провайдера дозволяє виставляти
 * рахунки від імені викладача, тому його ключ має ротуватись окремо.
 */
@Injectable()
export class TokenCipher {
  get available(): boolean {
    return config.paymentTokenKey !== null;
  }

  private key(): Buffer {
    const secret = config.paymentTokenKey;
    if (!secret) {
      throw new ServiceUnavailableException(
        'підключення оплати недоступне: не задано PAYMENT_TOKEN_KEY',
      );
    }
    // Приводимо парольну фразу будь-якої довжини до рівно 32 байтів ключа.
    return createHash('sha256').update(secret).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12); // 96 біт — рекомендований розмір для GCM
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      data.toString('base64url'),
    ].join(':');
  }

  decrypt(stored: string): string {
    const [version, iv, tag, data] = stored.split(':');
    if (version !== 'v1' || !iv || !tag || !data) {
      throw new Error('несподіваний формат збереженого токена');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * Те, що можна показати в інтерфейсі: кілька останніх символів.
   * Повний токен не повертається назовні ніколи, навіть власнику.
   */
  static hint(plain: string): string {
    return plain.length <= 4 ? '••••' : `••••${plain.slice(-4)}`;
  }
}
