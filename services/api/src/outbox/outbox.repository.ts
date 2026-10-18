import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { OutboxJob } from '@tutorflow/contracts';
import { KYSELY, type Database, type Executor } from '../db/database.module.js';

/** Рядок журналу, узятий у роботу. */
export interface ClaimedJob {
  id: number;
  kind: string;
  payload: unknown;
  opId: string | null;
  attempts: number;
}

/**
 * Витримка між спробами: 2^спроби секунд, але не більше хвилини.
 *
 * Рахується в SQL, а не в коді, бо ставиться вона тією самою командою, що й
 * захоплення рядка: між читанням і записом не повинно бути проміжку, у який
 * другий процес узяв би те саме завдання.
 */
const MAX_BACKOFF_SEC = 60;

@Injectable()
export class OutboxRepository {
  constructor(@Inject(KYSELY) private readonly root: Database) {}

  private db(tx?: Executor): Executor { return tx ?? this.root; }

  /**
   * Записати завдання. ОБОВʼЯЗКОВО в тій самій транзакції, що й зміна даних,
   * яку воно описує, — інакше весь сенс outbox зникає.
   */
  async add(job: OutboxJob, opId: string | null = null, tx?: Executor): Promise<{ id: number }> {
    const row = await this.db(tx)
      .insertInto('outbox')
      .values({
        kind: job.kind,
        payload: JSON.stringify(job.payload),
        op_id: opId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return { id: row.id };
  }

  /**
   * Узяти пачку завдань у роботу.
   *
   * `for update skip locked` потрібен не для коректності доставки — від
   * подвійного ЗАСТОСУВАННЯ захищає ключ операції на боці отримувача, — а щоб
   * два дренажі не робили ту саму марну роботу. `attempts` і витримка
   * ставляться тим самим запросом: рядок, узятий у роботу, одразу відкладений
   * на наступну спробу, тому падіння процесу посеред доставки не лишає
   * завдання «назавжди в роботі».
   *
   * Порядок — за `id`, тобто за часом вставки. Це важливо: перенесення
   * заняття записує повернення й списання двома рядками, і застосувати їх у
   * зворотному порядку означало б показати студентові борг, якого немає.
   */
  async claim(limit: number, tx?: Executor): Promise<ClaimedJob[]> {
    const res = await sql<{
      id: number; kind: string; payload: unknown; op_id: string | null; attempts: number;
    }>`
      update outbox
         set attempts = attempts + 1,
             next_attempt_at = now() + make_interval(
               secs => least(power(2, attempts)::int, ${MAX_BACKOFF_SEC}))
       where id in (
         select id from outbox
          where delivered_at is null
            and next_attempt_at <= now()
          order by id
          limit ${limit}
          for update skip locked
       )
      returning id, kind, payload, op_id, attempts
    `.execute(this.db(tx));

    return res.rows
      .map((r) => ({
        id: r.id, kind: r.kind, payload: r.payload, opId: r.op_id, attempts: r.attempts,
      }))
      // returning не гарантує порядку, а порядок тут частина правильності
      .sort((a, b) => a.id - b.id);
  }

  /** Доставлено й підтверджено: більше не повторюється. */
  async markDelivered(id: number, tx?: Executor): Promise<void> {
    await this.db(tx)
      .updateTable('outbox')
      .set({ delivered_at: new Date(), last_error: null })
      .where('id', '=', id)
      .execute();
  }

  /**
   * Спроба не вдалась. Нова спроба вже призначена захопленням, тому тут
   * лишається тільки слід причини — його видно в psql, коли щось не ходить.
   */
  async noteError(id: number, message: string, tx?: Executor): Promise<void> {
    await this.db(tx)
      .updateTable('outbox')
      .set({ last_error: message.slice(0, 500) })
      .where('id', '=', id)
      .execute();
  }

  /**
   * Скільки завдань чекає доставки. Показник здоровʼя межі: нуль означає, що
   * сусід відповідає, а зростання — що ні.
   */
  async pendingCount(tx?: Executor): Promise<number> {
    const row = await this.db(tx)
      .selectFrom('outbox')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('delivered_at', 'is', null)
      .executeTakeFirst();

    return Number(row?.n ?? 0);
  }
}
