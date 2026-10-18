/**
 * Стрічка `.ics` для СТУДЕНТА: своя колонка, а не спільна з викладачем.
 *
 * Токен лежить у таблиці власника занять — тільки так за самим токеном видно,
 * чий розклад віддавати. Одна спільна таблиця токенів тут нічого не дала б:
 * пошук однаково йшов би по тій самій колонці, а ризик віддати не той розклад
 * зріс би.
 *
 * `unique` обовʼязковий: токен — це ключ автентифікації, і збіг двох значень
 * означав би, що одна адреса відкриває два розклади.
 */
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table students add column calendar_token text unique`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table students drop column if exists calendar_token`.execute(db);
}
