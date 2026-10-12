/**
 * Зайнятість викладача ПОЗА нашим розкладом і секретна адреса його календаря.
 *
 * Дві речі в одній міграції, бо вони — дві половини одного питання: як наш
 * розклад співіснує з календарем, у якому викладач живе насправді.
 *
 * `external_busy` — інтервали, у які викладач зайнятий чимось, чого ми не
 * знаємо: лікар, інша робота, подія з Google Calendar. Зберігається саме
 * ІНТЕРВАЛОМ, а не годиною: зовнішні події не вирівняні по нашій сітці, і
 * «зайнято з 15:40 до 16:20» мусить лягати як є. Звідси `tstzrange` і той
 * самий GiST-індекс, що й у слотів, — перевірка перетину `&&` має бути швидкою,
 * бо вона в гарячому шляху календаря.
 *
 * Чому не exclusion constraint, як у слотів: зовнішні інтервали ПЕРЕТИНАТИСЬ
 * можуть. Дві події в чужому календарі накладаються одна на одну скільки
 * завгодно — це не наша інваріанта, і забороняти її ми не маємо права.
 *
 * `teachers.calendar_token` — секрет у рядку адреси. Стрічку `.ics` читає
 * календарна програма, яка не вміє ні увійти, ні віддати заголовок
 * авторизації: єдине, що вона вміє, — відкрити URL. Тому доступ дає сам
 * токен, і саме тому він має бути довгим, унікальним і таким, що його можна
 * перевипустити.
 */
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table external_busy (
      id          bigserial primary key,
      teacher_id  integer not null references teachers(id) on delete cascade,
      start_at    timestamptz not null,
      end_at      timestamptz not null,
      /* звідки взялось: ручний запис, Google Calendar, стрічка .ics */
      source      text not null default 'manual'
        check (source in ('manual', 'google', 'ics')),
      /* ідентифікатор події в зовнішній системі — щоб повторна синхронізація
         оновлювала той самий рядок, а не додавала новий */
      external_id text,
      title       text,
      /* обчислюється базою, як і в слотів: один опис інтервалу, а не два поля,
         які можуть розійтись */
      period      tstzrange generated always as (tstzrange(start_at, end_at, '[)')) stored,
      created_at  timestamptz not null default now(),

      constraint external_busy_period_valid check (end_at > start_at),
      /* повторна синхронізація однієї події — оновлення, а не дублікат */
      unique (teacher_id, source, external_id)
    )`.execute(db);

  await sql`
    create index external_busy_period on external_busy using gist (teacher_id, period)`
    .execute(db);

  await sql`
    alter table teachers
      add column calendar_token text unique`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table teachers drop column if exists calendar_token`.execute(db);
  await sql`drop table if exists external_busy`.execute(db);
}
