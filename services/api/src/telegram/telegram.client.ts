import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config.js';

/**
 * Межа з Telegram Bot API. Той самий прийом, що з monobank: клієнт знає про
 * HTTP, сервіс — ні.
 *
 * Канал вибраний за ціною й вимогами: Bot API безкоштовний, не потребує ні
 * верифікації бізнесу, ні номера телефону студента, і працює на long polling —
 * тобто без публічної адреси. Останнє важливо: нагадування можна перевірити на
 * локальній машині, як і оплату.
 */

/** Оновлення від Telegram. Беремо лише те, що потрібно для привʼязки чату. */
export interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; first_name?: string; username?: string };
  };
}

@Injectable()
export class TelegramClient {
  private readonly log = new Logger('TelegramClient');
  private username: string | null = null;

  get enabled(): boolean {
    return config.telegram.botToken !== null;
  }

  private async call<T>(method: string, body?: unknown): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });

    const payload = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!payload.ok) {
      // Опис помилки від Telegram не містить секретів, але токен у шлях
      // підставлений — тому в лог іде лише метод і опис.
      throw new Error(`telegram ${method}: ${payload.description ?? res.status}`);
    }
    return payload.result as T;
  }

  /**
   * Імʼя бота. Потрібне для посилання `t.me/<бот>?start=<код>` і кешується:
   * воно не змінюється, а запитувати його на кожне відкриття екрана немає за чим.
   */
  async botUsername(): Promise<string | null> {
    if (!this.enabled) return null;
    if (this.username) return this.username;
    try {
      const me = await this.call<{ username?: string }>('getMe');
      this.username = me.username ?? null;
      return this.username;
    } catch (e) {
      this.log.warn(`getMe не вдався: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /**
   * Надіслати повідомлення. Кидає виняток — вирішувати, що робити з
   * недоставленим нагадуванням, має сервіс, а не межа з мережею.
   */
  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.call('sendMessage', {
      chat_id: chatId,
      text,
      // Розмітку не вмикаємо: у текстах нагадувань є «₴» і числа, а не
      // форматування, зате є ризик впасти на неекранованому символі.
      disable_notification: false,
    });
  }

  /**
   * Long polling: запрос висить на боці Telegram до `timeoutSec`, доки не
   * зʼявиться оновлення. Це не опитування — з'єднання одне, і воно мовчить,
   * доки немає роботи. Вебхук потребував би публічної адреси, якої локально
   * немає.
   *
   * `offset` — це підтвердження: передаючи `update_id + 1`, ми кажемо Telegram,
   * що попередні оновлення оброблені й їх можна забути.
   */
  getUpdates(offset: number, timeoutSec = 25): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>('getUpdates', {
      offset,
      timeout: timeoutSec,
      allowed_updates: ['message'],
    });
  }
}
