import { Inject, Injectable } from '@nestjs/common';
import { sql, type SqlBool } from 'kysely';
import { KYSELY, type Database } from '../db/database.module.js';
import type { PaymentProviderColumn, PaymentStatusColumn } from '../db/schema.js';
import type { Executor } from '../db/database.module.js';

@Injectable()
export class PaymentsRepository {
  constructor(@Inject(KYSELY) private readonly root: Database) {}

  private db(tx?: Executor): Executor {
    return tx ?? this.root;
  }

  /** Рядок створюється ДО звернення до провайдера, щоб його id став reference. */
  async create(
    p: {
      studentId: number;
      teacherId: number;
      provider: PaymentProviderColumn;
      amountMinor: number;
    },
    tx?: Executor,
  ) {
    return this.db(tx)
      .insertInto('payments')
      .values({
        student_id: p.studentId,
        teacher_id: p.teacherId,
        provider: p.provider,
        amount_minor: p.amountMinor,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async attachInvoice(id: number, providerPaymentId: string, pageUrl: string, tx?: Executor) {
    return this.db(tx)
      .updateTable('payments')
      .set({ provider_payment_id: providerPaymentId, page_url: pageUrl, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  byId(id: number, tx?: Executor) {
    return this.db(tx)
      .selectFrom('payments')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  byInvoice(provider: PaymentProviderColumn, providerPaymentId: string, tx?: Executor) {
    return this.db(tx)
      .selectFrom('payments')
      .selectAll()
      .where('provider', '=', provider)
      .where('provider_payment_id', '=', providerPaymentId)
      .executeTakeFirst();
  }

  /**
   * Єдина точка, де платіж стає оплаченим.
   *
   * Умова `status <> 'paid'` — це і є захист від повторного вебхука: база
   * блокує рядок на час UPDATE, тож із двох одночасних доставок рядок отримає
   * рівно одна, друга побачить 0 рядків і нічого не зарахує. Той самий прийом,
   * що й у захопленні слота, — перевірка і зміна в одному запросі, без
   * «спершу прочитати, потім записати».
   *
   * transaction_id ставиться тут же: обмеження в базі не дозволить статусу
   * `paid` існувати без проводки в журналі.
   */
  async markPaid(
    p: {
      provider: PaymentProviderColumn;
      providerPaymentId: string;
      transactionId: number;
      raw: unknown;
    },
    tx?: Executor,
  ) {
    const row = await this.db(tx)
      .updateTable('payments')
      .set({
        status: 'paid',
        transaction_id: p.transactionId,
        raw: JSON.stringify(p.raw),
        updated_at: new Date(),
      })
      .where('provider', '=', p.provider)
      .where('provider_payment_id', '=', p.providerPaymentId)
      .where('status', '!=', 'paid')
      .returningAll()
      .executeTakeFirst();

    return row ?? null;
  }

  /** Неуспішні та проміжні стани. Грошей не рухає, тому без транзакції. */
  async markStatus(
    p: {
      provider: PaymentProviderColumn;
      providerPaymentId: string;
      status: PaymentStatusColumn;
      raw: unknown;
    },
    tx?: Executor,
  ) {
    const row = await this.db(tx)
      .updateTable('payments')
      .set({ status: p.status, raw: JSON.stringify(p.raw), updated_at: new Date() })
      .where('provider', '=', p.provider)
      .where('provider_payment_id', '=', p.providerPaymentId)
      // оплачений платіж не відкочується вебхуком: повернення коштів — окрема
      // операція з власною проводкою, а не зміна статусу заднім числом
      .where('status', '!=', 'paid')
      .returningAll()
      .executeTakeFirst();

    return row ?? null;
  }

  recentByStudent(studentId: number, limit = 10, tx?: Executor) {
    return this.db(tx)
      .selectFrom('payments')
      .select(['id', 'amount_minor', 'status', 'page_url', 'created_at'])
      .where('student_id', '=', studentId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
  }

  /**
   * Протермінувати зависле. Викликається вручну в лабораторній 1 і воркером
   * у лабораторній 2 — так само, як expireHolds для слотів.
   */
  async expirePending(olderThanMinutes = 60, tx?: Executor): Promise<number> {
    const res = await this.db(tx)
      .updateTable('payments')
      .set({ status: 'expired', updated_at: new Date() })
      .where('status', '=', 'pending')
      .where(sql<SqlBool>`created_at < now() - make_interval(mins => ${olderThanMinutes})`)
      .executeTakeFirst();

    return Number(res.numUpdatedRows ?? 0);
  }
}
