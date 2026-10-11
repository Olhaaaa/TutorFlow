import { Injectable, Logger } from '@nestjs/common';
import { TelegramService } from '../telegram/telegram.service.js';
import { NotificationsRepository } from './notifications.repository.js';

/** Що зробила спроба доставки. Три стани, бо вони лікуються по-різному. */
export type DeliveryOutcome = 'telegram' | 'log' | 'failed';

/**
 * Доставка нагадувань.
 *
 * Канал вибирається не налаштуванням, а станом студента: є привʼязаний чат —
 * іде в Telegram; немає — лишається в лозі, і саме «лог» записується каналом,
 * а не вдається, ніби нагадування пішло в нікуди.
 *
 * Різниця між `log` і `failed` принципова. `log` — остаточний стан: більше
 * нічого зробити не можна, доки студент не привʼяже чат, тому нагадування
 * позначається доставленим і не висить у черзі вічно. `failed` — тимчасове:
 * чат є, але Telegram не відповів, тому рядок лишається недоставленим і його
 * забере наступний прохід воркера.
 */
@Injectable()
export class NotificationsDelivery {
  private readonly log = new Logger('Delivery');

  constructor(
    private readonly notifications: NotificationsRepository,
    private readonly telegram: TelegramService,
  ) {}

  async deliver(id: number, studentId: number, text: string): Promise<DeliveryOutcome> {
    try {
      const sent = await this.telegram.deliver(studentId, text);
      if (sent) {
        await this.notifications.markSent(id, 'telegram');
        return 'telegram';
      }
    } catch (e) {
      // Канал є, але недоступний: НЕ позначаємо доставленим.
      this.log.warn(
        `нагадування ${id} не доставлено: ${e instanceof Error ? e.message : String(e)}`,
      );
      return 'failed';
    }

    // Чат не привʼязаний або канал вимкнений — лог і є доставка.
    this.log.log(`студенту ${studentId}: ${text}`);
    await this.notifications.markSent(id, 'log');
    return 'log';
  }

  /**
   * Перепробувати недоставлені. Викликається з того самого проходу воркера,
   * що й переходи станів: обидві роботи тягне час.
   *
   * @returns скільком нагадуванням доставка вдалась цього разу.
   */
  async retryPending(limit = 50): Promise<number> {
    const pending = await this.notifications.pending(limit);
    let delivered = 0;

    for (const n of pending) {
      const outcome = await this.deliver(n.id, n.student_id, n.text);
      if (outcome !== 'failed') delivered += 1;
    }

    return delivered;
  }
}
