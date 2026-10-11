import { Injectable } from '@nestjs/common';
import { config } from '../config.js';
import { PaymentsRepository } from '../payments/payments.repository.js';
import { SchedulingService } from '../scheduling/scheduling.service.js';

export interface MaintenanceResult {
  /** Закріплення, які не оплатили вчасно: слоти звільнено. */
  holdsExpired: number;
  /** Заняття, час яких минув: переведені в «проведено». */
  lessonsCompleted: number;
  /** Рахунки, за якими так і не заплатили. */
  paymentsExpired: number;
}

/**
 * Переходи станів, які робить час, а не користувач.
 *
 * Модель обіцяє, що неоплачене закріплення звільняється після
 * `hold_expires_at`, проведене заняття стає `done`, а несплачений рахунок —
 * `expired`. Виконати обіцянку мусить хтось, кого не просив жоден користувач.
 *
 * Усі три — ідемпотентні UPDATE з умовою «вже настав час», тому їх безпечно
 * виконувати і за розкладом, і вручну, і кільком екземплярам одночасно:
 * повторний виклик просто не знайде рядків.
 *
 * Сервіс НЕ має власного таймера. У лабораторній 1 таймер жив тут, усередині
 * процесу API, і це було свідомо тимчасово: при scale-to-zero процес засинає
 * разом із таймером. Тепер розкладом керує окремий процес — `src/worker.ts`, —
 * а цей клас лишився тим, чим мусив бути: одним проходом без знання про те,
 * хто його викликав. Той самий `runOnce` використовує і кнопка в кабінеті
 * викладача, і воркер.
 */
@Injectable()
export class MaintenanceService {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly payments: PaymentsRepository,
  ) {}

  /** Один прохід. Повертає, що саме змінилось — це й показується в інтерфейсі. */
  async runOnce(now = new Date()): Promise<MaintenanceResult> {
    const [holds, lessons, payments] = await Promise.all([
      this.scheduling.expireHolds(now),
      this.scheduling.completePast(now),
      this.payments.expirePending(config.paymentValidityMinutes),
    ]);

    return {
      holdsExpired: holds.length,
      lessonsCompleted: lessons.length,
      paymentsExpired: payments,
    };
  }
}
