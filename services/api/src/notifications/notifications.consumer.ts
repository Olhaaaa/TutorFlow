import { Injectable, Logger } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';
import { config } from '../config.js';
import {
  EVENTS_STREAM, dedupKey, renderNotification, type DomainEvent,
} from '@tutorflow/contracts';
import { NotificationsDelivery } from './notifications.delivery.js';
import { NotificationsRepository } from './notifications.repository.js';

/** Імʼя групи споживачів. Інші споживачі того самого стріму отримають свої. */
const GROUP = 'notifications';

/**
 * Через скільки повідомлення, узяте й не підтверджене, вважається покинутим.
 *
 * Обробка триває мілісекунди, тому хвилина означає одне: споживач, який узяв
 * це повідомлення, більше не живе. У лабораторній 4 це стане штатною подією —
 * KEDA гасить поди, щойно стрім порожніє, і той, кого вбили між читанням і
 * `XACK`, лишає по собі комірку в списку непідтверджених.
 */
const STALE_MS = 60_000;

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

  constructor(
    private readonly notifications: NotificationsRepository,
    private readonly delivery: NotificationsDelivery,
  ) {}

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
        // Тиша — слушний момент підібрати покинуте. Під навантаженням цей
        // виклик не робиться зовсім: спершу треба розгребти свіже.
        if (!reply) {
          await this.reclaimStale(client, consumerName);
          continue;
        }

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

  /**
   * Забрати повідомлення, які хтось узяв і не підтвердив.
   *
   * Без цього втрачається рівно те, через що й обрано групу споживачів: помер
   * споживач — його комірка в PEL лежить вічно, і нагадування не надішле
   * ніхто. `XAUTOCLAIM` переписує власника на нас і віддає повідомлення, після
   * чого воно проходить звичайний шлях, включно з дедуплікацією.
   */
  private async reclaimStale(client: RedisClientType, consumerName: string): Promise<void> {
    const claimed = await client.xAutoClaim(
      EVENTS_STREAM, GROUP, consumerName, STALE_MS, '0', { COUNT: 10 },
    );

    for (const message of claimed.messages) {
      // null трапляється, якщо запис зі стріму вже витерли тримінгом: комірку
      // в PEL XAUTOCLAIM при цьому прибирає сам.
      if (!message) continue;
      this.log.warn(`підбираю покинуте повідомлення ${message.id}`);
      await this.handle(client, message.id, message.message as Record<string, string>);
    }
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
        // Канал вибирає доставка: є привʼязаний чат — Telegram, немає — лог.
        // Якщо канал є, але недоступний, рядок лишиться недоставленим, і його
        // забере наступний прохід воркера. Подію при цьому підтверджуємо:
        // нагадування вже записане, і повторне читання стріму його не
        // відправило б, бо дедуплікація не дала б створити другий рядок.
        await this.delivery.deliver(created.id, created.student_id, created.text);
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
