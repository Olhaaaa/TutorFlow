import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  BalanceResult, StudentCalendarToken, StudentIdentity, StudentNames,
} from '@tutorflow/contracts';
import type { Executor } from '../db/database.module.js';
import type { PaymentsExpiryPort } from '../maintenance/ports.js';
import type { ChargePort, StudentDirectoryPort } from '../scheduling/ports.js';
import { OutboxRepository } from '../outbox/outbox.repository.js';
import { InternalClient } from './internal.client.js';
import { newOpId } from './op-id.js';

/**
 * ChargePort без спільної транзакції — головна відмінність двох архітектур.
 *
 * Підпис інтерфейсу не змінився: кожен метод так само приймає `tx`. Змінилось
 * те, ЩО в цій транзакції відбувається.
 *
 * **Списання й повернення** не рухають гроші — вони пишуть ЗАВДАННЯ в журнал
 * outbox тією самою транзакцією, що змінює слот. Через це неможливий стан
 * «слот заброньований, а про гроші ніхто не дізнався»: або є і слот, і
 * завдання, або немає нічого. Самі гроші рухає сусідній сервіс, коли завдання
 * до нього доїде — одразу після коміту, якщо він живий, або з повтором, якщо
 * ні.
 *
 * **Читання балансу** транзакцію ІГНОРУЄ, і інакше бути не може: баланс лежить
 * у чужій базі. Звідси й найцікавіший наслідок поділу — перевірка «чи
 * вистачає коштів» більше не атомарна з захопленням слота. Між нею й
 * списанням паралельна операція встигає зрушити баланс, і тоді сусід
 * відмовляє. Відповідь на цю відмову — компенсація: заняття повертається в
 * `pre_booked`. У моноліті така ситуація неможлива в принципі.
 */
@Injectable()
export class ChargeViaOutbox implements ChargePort {
  private readonly log = new Logger('ChargeViaOutbox');

  constructor(
    private readonly internal: InternalClient,
    private readonly outbox: OutboxRepository,
  ) {}

  async balanceOf(_tx: Executor, studentId: number): Promise<number> {
    const res = await this.internal.get<BalanceResult>(
      'billing', `/internal/students/${studentId}/balance`,
    );
    return res.balanceMinor;
  }

  /**
   * Чи вистачає коштів.
   *
   * Якщо білінг не відповів, відповідь «ні» — і це не помилка, а ЗАХИСТ:
   * слот стає `pre_booked`, місце за студентом закріплене, кошти не рухались.
   * Протилежне рішення (вважати, що вистачає) створило б оплачене заняття, за
   * яким, можливо, нічим платити. Доступність бронювання тут важливіша за
   * точність статусу, а цілісність грошей — важливіша за обидві.
   */
  async isAffordable(tx: Executor, studentId: number, priceMinor: number): Promise<boolean> {
    try {
      return (await this.balanceOf(tx, studentId)) >= priceMinor;
    } catch (e) {
      this.log.warn(
        `баланс студента ${studentId} недоступний, бронюю як неоплачене: ${msg(e)}`,
      );
      return false;
    }
  }

  async chargeForLesson(
    tx: Executor, studentId: number, slotId: number, priceMinor: number,
  ): Promise<void> {
    await this.defer('billing.charge', tx, studentId, slotId, priceMinor);
  }

  async refundForLesson(
    tx: Executor, studentId: number, slotId: number, priceMinor: number,
  ): Promise<void> {
    await this.defer('billing.refund', tx, studentId, slotId, priceMinor);
  }

  private async defer(
    kind: 'billing.charge' | 'billing.refund',
    tx: Executor,
    studentId: number,
    slotId: number,
    priceMinor: number,
  ): Promise<void> {
    const opId = newOpId();
    await this.outbox.add(
      { kind, payload: { opId, studentId, slotId, amountMinor: priceMinor } },
      opId,
      tx,
    );
  }
}

/** Довідник студентів по HTTP: той самий порт, тільки чужа база. */
@Injectable()
export class StudentDirectoryOverHttp implements StudentDirectoryPort {
  constructor(private readonly internal: InternalClient) {}

  async namesByIds(ids: readonly number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    // Пакетом одним запросом: екран тижня містить десятки занять, і запрос на
    // кожне перетворив би один `join` на десятки звернень по мережі.
    const res = await this.internal.get<StudentNames>(
      'billing', `/internal/students/names?ids=${ids.join(',')}`,
    );
    return new Map(res.students.map((s) => [s.id, s.name]));
  }

  async ensureCalendarToken(studentId: number) {
    const res = await this.internal.post<StudentCalendarToken>(
      'billing', `/internal/students/${studentId}/calendar-token`,
    );
    return {
      id: res.id, name: res.name, timezone: res.timezone, calendarToken: res.calendarToken,
    };
  }

  async clearCalendarToken(studentId: number): Promise<void> {
    await this.internal.post('billing', `/internal/students/${studentId}/calendar-token/revoke`);
  }

  async byCalendarToken(token: string) {
    const res = await this.internal.get<StudentIdentity | null>(
      'billing', `/internal/students/by-calendar-token/${encodeURIComponent(token)}`,
    );
    return res && res.id ? res : null;
  }
}

/**
 * Протермінування рахунків живе в білінгу, а прохід переходів — у розкладі.
 *
 * Кнопка «оновити стани» в кабінеті викладача мусить і далі показувати число
 * протермінованих рахунків, тому прохід питає сусіда. Якщо сусіда немає,
 * прохід НЕ падає: звільнення закріплень і закриття занять — своя робота
 * розкладу, і вона не повинна залежати від доступності білінгу.
 */
@Injectable()
export class PaymentsExpiryOverHttp implements PaymentsExpiryPort {
  private readonly log = new Logger('PaymentsExpiry');

  constructor(private readonly internal: InternalClient) {}

  async expirePending(validityMinutes: number): Promise<number> {
    try {
      const res = await this.internal.post<{ expired: number }>(
        'billing', '/internal/payments/expire', { validityMinutes },
      );
      return res.expired;
    } catch (e) {
      this.log.warn(`протермінування рахунків пропущено: ${msg(e)}`);
      return 0;
    }
  }
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
