import { Injectable } from '@nestjs/common';
import type { LessonsPort } from '../billing/ports.js';
import type { Executor } from '../db/database.module.js';
import { SchedulingService } from './scheduling.service.js';
import { SlotsRepository } from './slots.repository.js';

/**
 * Реалізація межі, яку оголосив білінг.
 *
 * Адаптер тонкий навмисно: уся логіка «скільки занять покриває баланс» лежить
 * у ядрі й викликається з SchedulingService. Тут лише переклад імен колонок
 * бази у поля контракту — те, що в мікросервісах робить сериалізація в JSON, а
 * в моноліті не робить ніхто.
 */
@Injectable()
export class LessonsAdapter implements LessonsPort {
  constructor(
    private readonly slots: SlotsRepository,
    private readonly scheduling: SchedulingService,
  ) {}

  async pendingPayment(studentId: number, tx?: Executor) {
    const rows = await this.slots.pendingPayment(studentId, tx);
    return rows.map((r) => ({
      slotId: r.id,
      startAt: new Date(r.start_at).toISOString(),
      priceMinor: r.price_minor,
    }));
  }

  applyPayment(tx: Executor, studentId: number): Promise<number[]> {
    return this.scheduling.applyPayment(tx, studentId);
  }
}
