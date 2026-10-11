import { Inject, Injectable } from '@nestjs/common';
import { KYSELY, type Database } from '../db/database.module.js';
import type { Executor } from '../scheduling/slots.repository.js';
import type { DomainEvent, RenderedNotification } from '../events/events.js';

/** Журнал нагадувань. Належить вертикалі «Гроші й канали». */
@Injectable()
export class NotificationsRepository {
  constructor(@Inject(KYSELY) private readonly root: Database) {}

  private db(tx?: Executor): Executor { return tx ?? this.root; }

  /**
   * Записати нагадування, якщо його ще немає.
   *
   * `on conflict do nothing` по `dedup_key` — і є вся дедуплікація. Перевірка
   * «чи вже є такий ключ» окремим SELECT не захистила б: два екземпляри
   * споживача пройшли б її одночасно. Той самий прийом, що й захоплення слота,
   * тільки навпаки — тут нам потрібно, щоб другий НЕ отримав рядка.
   *
   * @returns рядок, якщо створили; null якщо така подія вже оброблена.
   */
  async add(
    n: RenderedNotification & { dedupKey: string; event: DomainEvent },
    tx?: Executor,
  ) {
    const row = await this.db(tx)
      .insertInto('notifications')
      .values({
        student_id: n.studentId,
        kind: n.kind,
        text: n.text,
        payload: JSON.stringify(n.event),
        dedup_key: n.dedupKey,
      })
      .onConflict((oc) => oc.column('dedup_key').doNothing())
      .returning(['id', 'student_id', 'text'])
      .executeTakeFirst();

    return row ?? null;
  }

  /** Позначити доставленим. Канал і час ставляться парою — так вимагає база. */
  async markSent(id: number, channel: string, tx?: Executor) {
    return this.db(tx)
      .updateTable('notifications')
      .set({ channel, sent_at: new Date() })
      .where('id', '=', id)
      .where('sent_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
  }

  /** Недоставлені — для екрана адміністратора й для перезапуску доставки. */
  pending(limit = 50, tx?: Executor) {
    return this.db(tx)
      .selectFrom('notifications')
      .select(['id', 'student_id', 'kind', 'text', 'created_at'])
      .where('sent_at', 'is', null)
      .orderBy('created_at')
      .limit(limit)
      .execute();
  }
}
