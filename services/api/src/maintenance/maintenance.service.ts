import { Injectable } from '@nestjs/common';
import { config } from '../config.js';
import { PaymentsRepository } from '../payments/payments.repository.js';
import { RemindersService } from '../scheduling/reminders.service.js';
import { SchedulingService } from '../scheduling/scheduling.service.js';

export interface MaintenanceResult {
  /** Закріплення, які не оплатили вчасно: слоти звільнено. */
  holdsExpired: number;
  /** Заняття, час яких минув: переведені в «проведено». */
  lessonsCompleted: number;
  /** Рахунки, за якими так і не заплатили. */
  paymentsExpired: number;
  /** Нагадування про заняття завтра: скільком студентам опубліковано подію. */
  lessonsReminded: number;
  /** Нагадування про строк оплати. */
  paymentsReminded: number;
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
    private readonly reminders: RemindersService,
  ) {}

  /**
   * Один прохід. Повертає, що саме змінилось — це й показується в інтерфейсі.
   *
   * Нагадування йдуть тим самим проходом, бо їх тягне та сама сила — час. Але
   * вони НЕ переходи станів: нічого в базі не змінюють, лише публікують
   * події. Тому й окремий сервіс, і окремі поля в результаті.
   *
   * Запас вікна нагадувань беремо з інтервалу проходу: подія, яку воркер
   * пропустив через простій, мусить лишитись у вікні наступного проходу.
   * Хвилина знизу — щоб ручний виклик із кабінету не шукав у нульовому вікні.
   */
  async runOnce(now = new Date()): Promise<MaintenanceResult> {
    const lookbackMin = Math.max(1, Math.ceil(config.maintenanceIntervalSec / 60) * 2);

    const [holds, lessons, payments, reminders] = await Promise.all([
      this.scheduling.expireHolds(now),
      this.scheduling.completePast(now),
      this.payments.expirePending(config.paymentValidityMinutes),
      this.reminders.publish(now, lookbackMin),
    ]);

    return {
      holdsExpired: holds.length,
      lessonsCompleted: lessons.length,
      paymentsExpired: payments,
      lessonsReminded: reminders.lessons,
      paymentsReminded: reminders.payments,
    };
  }
}
