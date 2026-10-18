import { Inject, Injectable } from '@nestjs/common';
import { KYSELY, type Database } from '../db/database.module.js';
import type { TransactionKindColumn } from '../db/schema.js';
import type { Executor } from '../scheduling/slots.repository.js';

/**
 * Напрямок руху коштів для фільтра історії: усе, надходження, списання.
 * `in`/`out`, а не `topup`/`lesson_charge`, бо вид операції й напрямок —
 * різні речі: повернення теж надходження.
 */
export type HistoryDirection = 'all' | 'in' | 'out';

/** Журнал усіх рухів коштів. Джерело істини для балансу. */
@Injectable()
export class TransactionsRepository {
  constructor(@Inject(KYSELY) private readonly root: Database) {}

  private db(tx?: Executor): Executor { return tx ?? this.root; }

  async add(
    t: {
      studentId: number;
      amountMinor: number;
      kind: TransactionKindColumn;
      slotId?: number | null;
      comment?: string | null;
    },
    tx?: Executor,
  ) {
    return this.db(tx)
      .insertInto('transactions')
      .values({
        student_id: t.studentId,
        amount_minor: t.amountMinor,
        kind: t.kind,
        slot_id: t.slotId ?? null,
        comment: t.comment ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Журнал операцій, найновіші спершу.
   *
   * `direction` фільтрує ЗАПРОСОМ, а не вже вибрану сторінку, і це не
   * прискорення, а умова правильності. Вікно обмежене, а списань у
   * журналі на порядок більше, ніж поповнень: у студента, який ходить
   * давно, останні двадцять рядків — суцільні заняття, і поповнення
   * недосяжне взагалі, скільки сторінку не гортай.
   *
   * Напрямок береться зі ЗНАКА суми, а не з переліку `kind`. Так
   * `refund` потрапляє до надходжень без окремої згадки, а `adjustment`
   * — у той бік, у який він справді зрушив баланс. Перелік видів
   * розширюється; знак — ні.
   */
  async recent(
    studentId: number,
    opts: { direction?: HistoryDirection; limit?: number } = {},
    tx?: Executor,
  ) {
    const { direction = 'all', limit = 20 } = opts;

    let q = this.db(tx)
      .selectFrom('transactions')
      .select(['id', 'amount_minor', 'kind', 'slot_id', 'comment', 'created_at'])
      .where('student_id', '=', studentId);

    if (direction === 'in') q = q.where('amount_minor', '>', 0);
    if (direction === 'out') q = q.where('amount_minor', '<', 0);

    return q
      .orderBy('created_at', 'desc')
      // Тай-брейк за id: сідер вносить операції заднім числом, і кілька
      // рядків лягають на ту саму секунду. Без другого ключа порядок між
      // ними не визначений, а значить і межа вікна теж.
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
  }

  /** Сума всіх транзакцій — для звірки з кешованим балансом. */
  async sum(studentId: number, tx?: Executor): Promise<number> {
    const row = await this.db(tx)
      .selectFrom('transactions')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('amount_minor'), eb.val(0)).as('total'))
      .where('student_id', '=', studentId)
      .executeTakeFirst();

    return Number(row?.total ?? 0);
  }

  /** Чи вже є списання за цей слот. Захист від подвійної оплати. */
  async hasChargeFor(slotId: number, tx?: Executor): Promise<boolean> {
    const row = await this.db(tx)
      .selectFrom('transactions')
      .select('id')
      .where('slot_id', '=', slotId)
      .where('kind', '=', 'lesson_charge')
      .executeTakeFirst();

    return row !== undefined;
  }
}
