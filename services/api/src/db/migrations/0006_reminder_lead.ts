/**
 * За скільки годин до події нагадувати — властивість ВИКЛАДАЧА, а не стала.
 *
 * Доба була зашита в ядрі, і для викладача з правилом скасування у 48 годин це
 * давало безглузде нагадування: воно приходило вже після того, як скасування
 * стало платним. Тобто нагадування мусить бути узгоджене з `cancel_hours`, а
 * воно в кожного своє.
 *
 * Межі перевіряє база, а не форма: година знизу — бо нагадування за пів
 * години до заняття нічого не змінює; тиждень згори — бо все, що далі, людина
 * однаково забуде.
 */
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table teachers
      add column reminder_lead_hours integer not null default 24
        constraint teachers_reminder_lead_sane check (reminder_lead_hours between 1 and 168)`
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table teachers drop column if exists reminder_lead_hours`.execute(db);
}
