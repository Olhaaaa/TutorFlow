import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
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
 * Досі ці три операції існували як методи, яких ніхто не викликав: модель
 * обіцяла, що неоплачене закріплення звільняється після hold_expires_at, а
 * проведене заняття стає `done`, — і жодна з обіцянок не виконувалась.
 *
 * Усі три — ідемпотентні UPDATE з умовою «вже настав час», тому їх безпечно
 * виконувати і за розкладом, і вручну, і кільком екземплярам одночасно:
 * повторний виклик просто не знайде рядків.
 *
 * У лабораторній 1 це таймер усередині процесу API. Рішення свідомо тимчасове:
 * при scale-to-zero процес засинає разом із таймером, тож переходи
 * відкладаються до наступного запиту. Саме це й стане приводом винести роботу
 * в окремий воркер у лабораторній 2 — із черги, а не з таймера.
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Maintenance');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly scheduling: SchedulingService,
    private readonly payments: PaymentsRepository,
  ) {}

  onApplicationBootstrap(): void {
    const sec = config.maintenanceIntervalSec;
    if (sec <= 0) {
      this.log.log('періодичні переходи вимкнені (MAINTENANCE_INTERVAL_SEC=0)');
      return;
    }

    // unref, щоб таймер не тримав процес живим під час вимкнення
    this.timer = setInterval(() => void this.tick(), sec * 1000);
    this.timer.unref();
    this.log.log(`періодичні переходи кожні ${sec} с`);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    try {
      const r = await this.runOnce();
      // Тиша, коли робити нема чого: інакше лог засмічується щохвилини.
      if (r.holdsExpired || r.lessonsCompleted || r.paymentsExpired) {
        this.log.log(
          `звільнено закріплень: ${r.holdsExpired}, `
          + `проведено занять: ${r.lessonsCompleted}, `
          + `протерміновано рахунків: ${r.paymentsExpired}`,
        );
      }
    } catch (e) {
      // Помилка одного проходу не повинна гасити таймер: наступний спробує знову.
      this.log.error(`прохід не вдався: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

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
