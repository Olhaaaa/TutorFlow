import { Inject, Injectable, Logger } from '@nestjs/common';
import { newLinkCode, parseLinkCode } from './link-code.js';
import { CONTACTS_PORT, type ContactsPort } from './ports.js';
import { TelegramClient } from './telegram.client.js';

/** Що показати студентові на картці каналу. */
export interface TelegramState {
  /** Чи налаштований канал на сервері взагалі. */
  available: boolean;
  linked: boolean;
  /** Код привʼязки. Null, якщо чат уже привʼязаний. */
  code: string | null;
  botUsername: string | null;
  /** Готове посилання: відкриває бота й надсилає код за студента. */
  deepLink: string | null;
}

/**
 * Канал нагадувань у Telegram: привʼязка чату й доставка.
 *
 * Тут немає ні HTTP, ні знання про те, хто викликав: сервіс однаково працює з
 * контролера (студент відкрив картку) і з воркера (прийшло оновлення від
 * бота).
 */
@Injectable()
export class TelegramService {
  private readonly log = new Logger('Telegram');

  constructor(
    @Inject(CONTACTS_PORT) private readonly contacts: ContactsPort,
    private readonly client: TelegramClient,
  ) {}

  get available(): boolean {
    return this.client.enabled;
  }

  /** Стан каналу для студента. Код створюється, якщо його ще немає. */
  async state(studentId: number): Promise<TelegramState> {
    const current = await this.contacts.contact(studentId);
    const linked = current !== null && current.telegramChatId !== null;

    if (!this.client.enabled) {
      return { available: false, linked, code: null, botUsername: null, deepLink: null };
    }

    // Привʼязаному чату код не потрібен: доки він є, нагадування ходять.
    if (linked) {
      return {
        available: true,
        linked: true,
        code: null,
        botUsername: await this.client.botUsername(),
        deepLink: null,
      };
    }

    const row = current?.telegramLinkCode
      ? current
      : await this.contacts.ensureLinkCode(studentId, newLinkCode());
    const code = row?.telegramLinkCode ?? null;
    const bot = await this.client.botUsername();

    return {
      available: true,
      linked: false,
      code,
      botUsername: bot,
      // Посилання краще за диктування коду: Telegram сам передасть його боту
      // як `/start <код>`, і студентові не доведеться нічого набирати.
      deepLink: bot && code ? `https://t.me/${bot}?start=${code}` : null,
    };
  }

  async unlink(studentId: number): Promise<TelegramState> {
    await this.contacts.unlink(studentId);
    return this.state(studentId);
  }

  /**
   * Обробити повідомлення від бота. Єдине, що бот умів би зробити корисного на
   * цьому етапі, — звʼязати чат; бронювати з чату ми свідомо не даємо, бо
   * календар двовимірний, а чат — ні.
   *
   * Відповідь надсилається завжди: мовчання бота людина читає як поломку.
   */
  async handleMessage(chatId: number | string, text: string | undefined): Promise<void> {
    const code = parseLinkCode(text);

    if (!code) {
      await this.reply(
        chatId,
        'Надішліть код привʼязки з картки «Нагадування» у застосунку — '
        + 'або просто відкрийте бота за посиланням звідти.',
      );
      return;
    }

    const student = await this.contacts.link(code, chatId);
    if (!student) {
      // Код не підійшов. Не кажемо, чи він узагалі існував: перебирати коди
      // через бота й так безглуздо, але підказувати не варто.
      await this.reply(chatId, 'Код не підійшов. Перевірте його на картці «Нагадування».');
      return;
    }

    this.log.log(`чат привʼязано до студента ${student.id}`);
    await this.reply(
      chatId,
      `Готово, ${student.name}. Надсилатиму тут нагадування про заняття й оплату.`,
    );
  }

  /**
   * Доставити текст студентові.
   *
   * @returns true якщо доставлено; false якщо чат не привʼязаний або канал
   *   вимкнений. Помилку мережі ПІДНІМАЄ вище: нагадування мусить лишитись
   *   недоставленим і дочекатись наступної спроби, а не бути позначеним як
   *   надіслане.
   */
  async deliver(studentId: number, text: string): Promise<boolean> {
    if (!this.client.enabled) return false;

    const contact = await this.contacts.contact(studentId);
    const chatId = contact?.telegramChatId;
    if (chatId === null || chatId === undefined) return false;

    // bigint із PostgreSQL драйвер віддає рядком, а не числом: Telegram
    // приймає обидва, тому зводимо до рядка й не втрачаємо точність.
    await this.client.sendMessage(String(chatId), text);
    return true;
  }

  private async reply(chatId: number | string, text: string): Promise<void> {
    try {
      await this.client.sendMessage(String(chatId), text);
    } catch (e) {
      this.log.warn(`відповідь не надіслано: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
