import { Inject, Injectable } from '@nestjs/common';
import { KYSELY, type Database } from '../db/database.module.js';
import type { TransactionKindColumn } from '../db/schema.js';
import type { Executor } from '../scheduling/slots.repository.js';

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

  async recent(studentId: number, limit = 20, tx?: Executor) {
    return this.db(tx)
      .selectFrom('transactions')
      .select(['id', 'amount_minor', 'kind', 'slot_id', 'comment', 'created_at'])
      .where('student_id', '=', studentId)
      .orderBy('created_at', 'desc')
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
