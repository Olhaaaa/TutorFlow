import { Inject, Injectable } from '@nestjs/common';
import { KYSELY, type Database } from '../db/database.module.js';
import type { Executor } from './slots.repository.js';

/**
 * Зайнятість викладача поза нашим розкладом.
 *
 * Таблиця існує для того, щоб доступність мала ОДНЕ джерело правди. Доки
 * зовнішні події лежать тут, функція доступності лишається одним запросом, а
 * синхронізація з Google Calendar у майбутньому — наповненням цієї таблиці, а
 * не правкою логіки календаря.
 */
@Injectable()
export class ExternalBusyRepository {
  constructor(@Inject(KYSELY) private readonly root: Database) {}

  private db(tx?: Executor): Executor { return tx ?? this.root; }

  list(teacherId: number, from: Date, to: Date, tx?: Executor) {
    return this.db(tx)
      .selectFrom('external_busy')
      .select(['id', 'start_at', 'end_at', 'source', 'title'])
      .where('teacher_id', '=', teacherId)
      .where('end_at', '>', from)
      .where('start_at', '<', to)
      .orderBy('start_at')
      .execute();
  }

  /**
   * Додати або оновити інтервал.
   *
   * `on conflict (teacher_id, source, external_id)` робить повторну
   * синхронізацію оновленням: подія, яку в чужому календарі перенесли, не
   * залишає по собі другий рядок. Для ручних записів `external_id` порожній, і
   * конфлікт не виникає — у PostgreSQL null не дорівнює null.
   */
  async upsert(
    teacherId: number,
    busy: {
      startAt: Date;
      endAt: Date;
      source?: 'manual' | 'google' | 'ics';
      externalId?: string | null;
      title?: string | null;
    },
    tx?: Executor,
  ) {
    return this.db(tx)
      .insertInto('external_busy')
      .values({
        teacher_id: teacherId,
        start_at: busy.startAt,
        end_at: busy.endAt,
        source: busy.source ?? 'manual',
        external_id: busy.externalId ?? null,
        title: busy.title ?? null,
      })
      .onConflict((oc) =>
        oc.columns(['teacher_id', 'source', 'external_id']).doUpdateSet({
          start_at: busy.startAt,
          end_at: busy.endAt,
          title: busy.title ?? null,
        }))
      .returning(['id', 'start_at', 'end_at', 'source', 'title'])
      .executeTakeFirstOrThrow();
  }

  /** Прибрати інтервал. Чужий не видалиться: умова по викладачу в тому ж запросі. */
  async remove(id: number, teacherId: number, tx?: Executor) {
    const row = await this.db(tx)
      .deleteFrom('external_busy')
      .where('id', '=', id)
      .where('teacher_id', '=', teacherId)
      .returning('id')
      .executeTakeFirst();

    return row ?? null;
  }
}
