import { Injectable, Logger } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';
import { config } from '../config.js';
import {
  EVENTS_STREAM, dedupKey, renderNotification, type DomainEvent,
} from '../events/events.js';
import { NotificationsRepository } from './notifications.repository.js';

/** Імʼя групи споживачів. Інші споживачі того самого стріму отримають свої. */
const GROUP = 'notifications';

/**
 * Канал доставки. Поки що лог: нагадування видно в `docker compose logs
 * worker`. Telegram стане другим значенням цього поля, і більше нічого в
 * споживачі не зміниться — саме для цього `channel` є колонкою, а не
 * прапорцем `sent`.
 */
const CHANNEL = 'log';

/**
 * Споживач подій: читає стрім і перетворює події на нагадування.
 *
 * Чому група споживачів, а не просте читання стріму: група тримає курсор на
 * боці Redis і список непідтверджених повідомлень (PEL). Тому, по-перше, кілька
 * екземплярів воркера ділять роботу, не дублюючи її, — це те, що в
 * лабораторній 4 множить KEDA. По-друге, повідомлення, яке споживач узяв і не
 * підтвердив, не зникає: після падіння його видно в PEL і можна забрати знову.
 *
 * `XACK` стоїть ПІСЛЯ запису в базу, а не до. Порядок дає at-least-once: якщо
 * процес упаде між записом і підтвердженням, подія прийде вдруге — і другий
 * раз не створить нагадування, бо `dedup_key` унікальний. Протилежний порядок
 * дав би at-most-once, тобто втрачені нагадування, а це гірше за повтор.
 */
@Injectable()
export class NotificationsConsumer {
  private readonly log = new Logger('Notifications');
  private client: RedisClientType | null = null;

  constructor(private readonly notifications: NotificationsRepository) {}

  /**
   * Читати стрім, доки не попросять спинитись.
   *
   * `BLOCK` замість опитування: з'єднання висить на `XREADGROUP`, і Redis сам
   * розбудить його, коли подія з'явиться. П'ять секунд — не інтервал
   * опитування, а крок, на якому ми перевіряємо прапорець спинення.
   */
  async run(stopping: () => boolean, consumerName: string): Promise<void> {
    if (!config.redisUrl) {
      this.log.log('споживач вимкнений: не задано REDIS_URL');
      return;
    }

    const client: RedisClientType = createClient({ url: config.redisUrl });
    client.on('error', (e: unknown) => {
      this.log.warn(`Redis: ${e instanceof Error ? e.message : String(e)}`);
    });
    await client.connect();
    this.client = client;

    // MKSTREAM створює стрім, якщо жодної події ще не публікували: інакше
    // воркер, піднятий раніше за API, впав би на відсутньому ключі.
    try {
      await client.xGroupCreate(EVENTS_STREAM, GROUP, '0', { MKSTREAM: true });
      this.log.log(`групу «${GROUP}» створено на стрімі ${EVENTS_STREAM}`);
    } catch (e) {
      // BUSYGROUP означає, що група вже є, і це нормальний стан.
      if (!(e instanceof Error) || !e.message.includes('BUSYGROUP')) throw e;
    }

    this.log.log(`читаю ${EVENTS_STREAM} як ${consumerName}`);

    while (!stopping()) {
      try {
        const reply = await client.xReadGroup(
          GROUP,
          consumerName,
          { key: EVENTS_STREAM, id: '>' },
          { COUNT: 10, BLOCK: 5000 },
        );
        if (!reply) continue; // за п'ять секунд нічого не прийшло

        for (const stream of reply) {
          for (const message of stream.messages) {
            await this.handle(client, message.id, message.message);
          }
        }
      } catch (e) {
        this.log.error(`читання не вдалось: ${e instanceof Error ? e.message : String(e)}`);
        // Пауза, щоб при недоступному Redis не крутити цикл на повній швидкості.
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    if (client.isOpen) await client.quit();
    this.client = null;
  }

  private async handle(
    client: RedisClientType,
    messageId: string,
    fields: Record<string, string>,
  ): Promise<void> {
    let event: DomainEvent;
    try {
      event = JSON.parse(fields['data'] ?? '{}') as DomainEvent;
    } catch {
      // Нерозбірливе повідомлення не має сенсу читати повторно: підтверджуємо
      // й лишаємо слід у лозі. Повтор дав би вічний цикл на одному рядку.
      this.log.error(`повідомлення ${messageId}: тіло не розбирається, пропускаю`);
      await client.xAck(EVENTS_STREAM, GROUP, messageId);
      return;
    }

    try {
      const rendered = renderNotification(event);
      const created = await this.notifications.add({
        ...rendered,
        dedupKey: dedupKey(event),
        event,
      });

      if (!created) {
        this.log.log(`${event.type}: повторна доставка, нагадування вже є`);
      } else {
        // Канал доставки. Поки що лог — і саме його ми позначаємо як канал,
        // а не вдаємо, що нагадування доставлене нікуди.
        this.log.log(`студенту ${created.student_id}: ${created.text}`);
        await this.notifications.markSent(created.id, CHANNEL);
      }

      await client.xAck(EVENTS_STREAM, GROUP, messageId);
    } catch (e) {
      // БЕЗ xAck: повідомлення лишається в PEL, і його можна забрати знову.
      this.log.error(
        `${event.type} не оброблено: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
