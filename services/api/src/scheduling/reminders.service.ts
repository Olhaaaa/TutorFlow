import { Injectable, Logger } from '@nestjs/common';
import { reminderWindow } from '@tutorflow/core';
import { EventBus } from '../events/event-bus.js';
import { SlotsRepository } from './slots.repository.js';

/** Скільком подіям про що нагадати цей прохід знайшов. */
export interface RemindersResult {
  lessons: number;
  payments: number;
}

/**
 * Нагадування про заняття й про строк оплати.
 *
 * Робота належить розкладу: лише він знає, коли починається заняття й коли
 * спливає закріплення. А ось «кому й як це показати» — не його справа:
 * сервіс публікує події й не знає ні про Telegram, ні про журнал нагадувань.
 *
 * Памʼяті про те, кому вже нагадано, тут немає навмисно. Вона є в журналі
 * нагадувань, і дублювати її в розкладі означало б тримати той самий факт у
 * двох місцях. Замість памʼяті — вікно з запасом назад, а від повторів
 * захищає `notifications.dedup_key`: продюсер at-least-once, споживач
 * ідемпотентний. Рівно те саме рішення, що й у платіжному вебхуку.
 */
@Injectable()
export class RemindersService {
  private readonly log = new Logger('Reminders');

  constructor(
    private readonly slots: SlotsRepository,
    private readonly events: EventBus,
  ) {}

  /**
   * Один прохід.
   *
   * @param lookbackMin запас назад у хвилинах. Мусить бути не меншим за
   *   інтервал проходу, інакше подія, яку воркер пропустив через простій,
   *   випаде з вікна назавжди.
   */
  async publish(now = new Date(), lookbackMin = 15): Promise<RemindersResult> {
    const { from, to } = reminderWindow(now, lookbackMin);

    const [lessons, payments] = await Promise.all([
      this.slots.upcomingForReminder(from, to),
      this.slots.paymentDueForReminder(from, to),
    ]);

    for (const slot of lessons) {
      await this.events.publish({
        type: 'lesson.upcoming',
        slotId: slot.id,
        studentId: slot.student_id!,
        startAt: new Date(slot.start_at).toISOString(),
        paid: slot.status === 'booked',
      });
    }

    for (const slot of payments) {
      await this.events.publish({
        type: 'payment.due',
        slotId: slot.id,
        studentId: slot.student_id!,
        startAt: new Date(slot.start_at).toISOString(),
        payBy: new Date(slot.hold_expires_at!).toISOString(),
        priceMinor: slot.price_minor,
      });
    }

    if (lessons.length || payments.length) {
      this.log.log(`нагадувань про заняття: ${lessons.length}, про оплату: ${payments.length}`);
    }

    return { lessons: lessons.length, payments: payments.length };
  }
}
