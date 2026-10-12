import { Injectable, Logger } from '@nestjs/common';
import { reminderWindow } from '@tutorflow/core';
import { EventBus } from '../events/event-bus.js';
import { SlotsRepository } from './slots.repository.js';
import { TeachersRepository } from './teachers.repository.js';

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
    private readonly teachers: TeachersRepository,
  ) {}

  /**
   * Один прохід.
   *
   * @param lookbackMin запас назад у хвилинах. Мусить бути не меншим за
   *   інтервал проходу, інакше подія, яку воркер пропустив через простій,
   *   випаде з вікна назавжди.
   */
  async publish(now = new Date(), lookbackMin = 15): Promise<RemindersResult> {
    /*
     * Строк нагадування в кожного викладача свій, тому вікно не одне.
     * Викладачі групуються за ВІДМІННИМИ значеннями строку: на платформі їх
     * одиниці, а формула вікна лишається в ядрі — замість `make_interval` по
     * колонці всередині SQL, де її ніхто не перевірить тестом.
     */
    const byLead = new Map<number, number[]>();
    for (const t of await this.teachers.reminderLeads()) {
      const group = byLead.get(t.reminder_lead_hours);
      if (group) group.push(t.id);
      else byLead.set(t.reminder_lead_hours, [t.id]);
    }

    const lessons: Awaited<ReturnType<SlotsRepository['upcomingForReminder']>> = [];
    const payments: Awaited<ReturnType<SlotsRepository['paymentDueForReminder']>> = [];

    for (const [leadHours, teacherIds] of byLead) {
      const { from, to } = reminderWindow(now, lookbackMin, leadHours);
      const [l, p] = await Promise.all([
        this.slots.upcomingForReminder(teacherIds, from, to),
        this.slots.paymentDueForReminder(teacherIds, from, to),
      ]);
      lessons.push(...l);
      payments.push(...p);
    }

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
