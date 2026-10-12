import {
  Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown,
} from '@nestjs/common';
import { config } from '../config.js';
import { MaintenanceService } from './maintenance.service.js';

/**
 * Таймер переходів станів УСЕРЕДИНІ процесу API.
 *
 * Це свідомий крок назад, і він потрібен рівно для одного випадку:
 * розгортання, у якому процес один. Безкоштовний тариф Render дає веб-сервіс,
 * але не дає фонового воркера, тому після переїзду лаби 2 в `main` на
 * продакшні не лишилось би НІКОГО, хто звільняє прострочені закріплення й
 * закриває проведені заняття. Модель обіцяє ці переходи, і обіцянка не
 * повинна залежати від тарифу.
 *
 * Тому прапорець, а не повернення старої поведінки: `MAINTENANCE_IN_API=true`
 * вмикає таймер там, де воркера немає. У компоузі лаби 2 прапорця немає —
 * переходи там робить воркер, і робити їх удвох немає за чим.
 *
 * Обидва режими безпечні одночасно: усі переходи — ідемпотентні UPDATE з
 * умовою «час уже настав», тому два процеси, які випадково робитимуть прохід
 * разом, не зіпсують даних. Другий просто не знайде рядків.
 *
 * Чому це не рішення назавжди: таймер живе, лише доки живий процес. При
 * scale-to-zero сервіс засинає після 15 хвилин простою, і переходи
 * відкладаються до наступного запросу. Саме це й робить воркер обовʼязковим у
 * лабораторній 4 — див. ADR-0011.
 */
@Injectable()
export class MaintenanceTimer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('MaintenanceTimer');
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly maintenance: MaintenanceService) {}

  onApplicationBootstrap(): void {
    if (!config.maintenanceInApi) return;

    const sec = config.maintenanceIntervalSec;
    if (sec <= 0) {
      this.log.warn('MAINTENANCE_IN_API задано, але MAINTENANCE_INTERVAL_SEC=0 — переходи не йдуть');
      return;
    }

    // unref, щоб таймер не тримав процес живим під час вимкнення
    this.timer = setInterval(() => void this.tick(), sec * 1000);
    this.timer.unref();
    this.log.log(`переходи станів у процесі API кожні ${sec} с (воркера в цьому розгортанні немає)`);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    try {
      const r = await this.maintenance.runOnce();
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
}
