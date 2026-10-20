/**
 * Самостійна реєстрація викладача, підтвердження пошти й зміна пароля.
 *
 * До цього викладачі зʼявлялися лише сідером, а пароль міняти було нічим.
 * Три речі, які тут вирішуються, і чому саме так.
 *
 * **Підтвердження пошти — колонка з МОМЕНТОМ, а не прапорець.** `boolean`
 * відповідає на питання «чи підтверджено», але не на «коли» — а друге
 * потрібно і для розбору інцидентів, і для політики на кшталт «не нагадуй
 * тим, хто підтвердив учора». Порожнє значення означає «ще ні».
 *
 * **Одноразові коди лежать у власній таблиці, а не колонками в профілі.**
 * Кодів у людини може бути кілька одночасно (запросила лист повторно), у них
 * різні призначення й різний строк життя, і їх треба видаляти пачкою після
 * використання. Колонками це виражається погано, таблицею — природно.
 *
 * **У базі лежить ХЕШ коду, а не сам код.** Код із листа — це пароль на один
 * раз: той, хто отримав доступ до таблиці, не повинен мати змоги ним
 * скористатись. `sha256` тут достатньо, на відміну від пароля: код довгий,
 * випадковий і живе години, тому перебирати його за хешем немає сенсу.
 *
 * **Обмеження частоти теж у базі.** Пам'ять процесу не годиться: у лабі 2
 * процесів уже два, у лабі 3 — пʼять, і лічильник у пам'яті означав би, що
 * ліміт обходиться повторним запросом в інший екземпляр.
 */
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table teachers
      add column email_verified_at   timestamptz,
      add column password_changed_at timestamptz not null default now()`.execute(db);

  await sql`
    alter table students
      add column password_changed_at timestamptz not null default now()`.execute(db);

  /* Усі, хто вже існує, вважаються підтвердженими: їх завів сідер або
     викладач, тобто поза формою реєстрації. Інакше після міграції ніхто з
     наявних викладачів не зміг би увійти. */
  await sql`update teachers set email_verified_at = created_at`.execute(db);

  await sql`
    create table auth_tokens (
      id          serial primary key,
      purpose     text not null check (purpose in ('verify_email', 'reset_password')),
      role        text not null check (role in ('teacher', 'student')),
      subject_id  integer not null,
      token_hash  text not null unique,
      expires_at  timestamptz not null,
      used_at     timestamptz,
      created_at  timestamptz not null default now(),

      -- строк життя завжди в майбутньому на момент випуску
      constraint auth_tokens_ttl_sane check (expires_at > created_at)
    )`.execute(db);

  /* Пошук «усі чинні коди цієї людини для цього призначення» — те, що
     робиться при кожному випуску нового коду й при використанні старого. */
  await sql`
    create index auth_tokens_subject on auth_tokens (role, subject_id, purpose)
      where used_at is null`.execute(db);

  /* Прибирання простроченого — окремий прохід обслуговування. */
  await sql`create index auth_tokens_expiry on auth_tokens (expires_at)`.execute(db);

  await sql`
    create table auth_throttle (
      key           text primary key,
      attempts      integer not null default 0 check (attempts >= 0),
      window_starts timestamptz not null default now()
    )`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists auth_throttle`.execute(db);
  await sql`drop table if exists auth_tokens`.execute(db);
  await sql`alter table students drop column if exists password_changed_at`.execute(db);
  await sql`
    alter table teachers
      drop column if exists email_verified_at,
      drop column if exists password_changed_at`.execute(db);
}
