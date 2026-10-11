import { Injectable, Logger } from '@nestjs/common';
import { TelegramClient } from './telegram.client.js';
import { TelegramService } from './telegram.service.js';

/**
 * Long polling оновлень від бота. Живе у воркері — там, де й решта роботи, яку
 * не просив жоден користувач.
 *
 * Вебхук був би дешевшим за трафіком, але вимагав би публічної адреси на
 * https. Для привʼязки чату це надто дорого: long polling тримає одне
 * з'єднання, яке мовчить, доки студент нічого не написав, і працює з
 * локальної машини так само, як із хмари.
 *
 * `offset` тримається в памʼяті процесу, і це свідомо. Після перезапуску
 * воркер перечитає оновлення за останні добу — Telegram стільки їх зберігає, —
 * і повторно обробить ті, що вже оброблені. Нічого не зламається: код
 * привʼязки згоряє при першому використанні, тому повторне `/start` із тим
 * самим кодом просто отримає «код не підійшов». Зберігати offset у базі заради
 * цього немає за чим.
 */
@Injectable()
export class TelegramUpdates {
  private readonly log = new Logger('TelegramUpdates');

  constructor(
    private readonly client: TelegramClient,
    private readonly telegram: TelegramService,
  ) {}

  async run(stopping: () => boolean): Promise<void> {
    if (!this.client.enabled) {
      this.log.log('бот вимкнений: не задано TELEGRAM_BOT_TOKEN');
      return;
    }

    this.log.log('слухаю оновлення бота');
    let offset = 0;

    while (!stopping()) {
      try {
        // Короткий таймаут, щоб прапорець спинення перевірявся частіше, ніж
        // раз на півхвилини: контейнер не повинен висіти на SIGTERM.
        const updates = await this.client.getUpdates(offset, 10);

        for (const update of updates) {
          offset = Math.max(offset, update.update_id + 1);
          const message = update.message;
          if (!message) continue;
          await this.telegram.handleMessage(message.chat.id, message.text);
        }
      } catch (e) {
        this.log.warn(`опитування не вдалось: ${e instanceof Error ? e.message : String(e)}`);
        // Пауза, щоб при недоступному Telegram не крутити цикл на повній швидкості.
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    this.log.log('слухання спинено');
  }
}
