import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { TokenPurpose } from '@tutorflow/core';
import { KYSELY, type Database, type Executor } from '../db/database.module.js';
import type { Role } from './token.service.js';

/**
 * Одноразові коди з листів і лічильники спроб.
 *
 * Код випускається у двох частинах: саме значення йде в лист, у базу лягає
 * його `sha256`. Той, хто прочитав таблицю, не може скористатись кодом —
 * рівно як із паролем. Повільний хеш тут не потрібен: код має 32 випадкові
 * байти й живе години, перебирати його немає сенсу.
 *
 * Порівняння хешів — `timingSafeEqual`, а не `===`. Різниця непомітна на
 * одному запросі, але на мільйоні вона зливається в сигнал: звичайне
 * порівняння завершується на першому розбіжному байті, і час відповіді
 * розказує, скільки символів збіглося.
 */
@Injectable()
export class AuthTokensRepository {
  constructor(@Inject(KYSELY) private readonly root: Database) {}

  private db(tx?: Executor): Executor { return tx ?? this.root; }

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Випустити код і погасити попередні того самого призначення.
   *
   * Погашення обовʼязкове: інакше людина, яка тричі натиснула «надіслати
   * ще раз», лишає три чинні коди, і найстаріший — у найдавнішому листі —
   * працює стільки ж, скільки найновіший.
   *
   * @returns сам код; у базі лишається лише його хеш
   */
  async issue(
    params: { purpose: TokenPurpose; role: Role; subjectId: number; expiresAt: Date },
    tx?: Executor,
  ): Promise<string> {
    const db = this.db(tx);

    await db
      .updateTable('auth_tokens')
      .set({ used_at: new Date() })
      .where('role', '=', params.role)
      .where('subject_id', '=', params.subjectId)
      .where('purpose', '=', params.purpose)
      .where('used_at', 'is', null)
      .execute();

    const token = randomBytes(32).toString('base64url');
    await db
      .insertInto('auth_tokens')
      .values({
        purpose: params.purpose,
        role: params.role,
        subject_id: params.subjectId,
        token_hash: AuthTokensRepository.hash(token),
        expires_at: params.expiresAt,
      })
      .execute();

    return token;
  }

  /**
   * Знайти чинний код і одразу його погасити.
   *
   * Пошук і погашення — ОДИН запрос із умовами всередині `UPDATE`, а не
   * «прочитати, перевірити, записати». Інакше дві одночасні відправки форми
   * обидві побачили б код непогашеним, і обидві змінили б пароль; друга —
   * на значення з повторно надісланої форми.
   *
   * @returns кому належав код, або null, якщо він невідомий, прострочений
   *          чи вже використаний
   */
  async consume(
    purpose: TokenPurpose,
    token: string,
    now: Date,
    tx?: Executor,
  ): Promise<{ role: Role; subjectId: number } | null> {
    const hash = AuthTokensRepository.hash(token);

    const row = await this.db(tx)
      .updateTable('auth_tokens')
      .set({ used_at: now })
      .where('token_hash', '=', hash)
      .where('purpose', '=', purpose)
      .where('used_at', 'is', null)
      .where('expires_at', '>', now)
      .returning(['role', 'subject_id', 'token_hash'])
      .executeTakeFirst();

    if (!row) return null;

    /* Хеш уже звірений індексом; це друга, стала за часом перевірка — вона
       нічого не коштує й знімає залежність від реалізації порівняння в базі. */
    const a = Buffer.from(row.token_hash, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    return { role: row.role, subjectId: row.subject_id };
  }

  /** Погасити всі чинні коди людини — після зміни пароля. */
  async revokeAll(role: Role, subjectId: number, now: Date, tx?: Executor): Promise<void> {
    await this.db(tx)
      .updateTable('auth_tokens')
      .set({ used_at: now })
      .where('role', '=', role)
      .where('subject_id', '=', subjectId)
      .where('used_at', 'is', null)
      .execute();
  }

  /** Прибрати давно прострочене. Викликається проходом обслуговування. */
  async purgeExpired(before: Date, tx?: Executor): Promise<number> {
    const rows = await this.db(tx)
      .deleteFrom('auth_tokens')
      .where('expires_at', '<', before)
      .returning('id')
      .execute();

    return rows.length;
  }

  /* ---------- лічильник спроб ---------- */

  /**
   * Прочитати стан лічильника.
   *
   * Запис робиться окремим викликом `bump`, бо рішення «дозволено чи ні»
   * ухвалює ядро, а не база: так правило перевіряється тестом без бази.
   */
  async throttleState(key: string, tx?: Executor) {
    const row = await this.db(tx)
      .selectFrom('auth_throttle')
      .select(['attempts', 'window_starts'])
      .where('key', '=', key)
      .executeTakeFirst();

    return row ? { attempts: row.attempts, windowStarts: new Date(row.window_starts) } : null;
  }

  async bump(key: string, state: { attempts: number; windowStarts: Date }, tx?: Executor) {
    await this.db(tx)
      .insertInto('auth_throttle')
      .values({ key, attempts: state.attempts, window_starts: state.windowStarts })
      .onConflict((oc) => oc.column('key').doUpdateSet({
        attempts: state.attempts,
        window_starts: state.windowStarts,
      }))
      .execute();
  }
}
