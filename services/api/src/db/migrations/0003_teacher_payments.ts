/**
 * Еквайринг стає власністю викладача, а не розгортання.
 *
 * До цієї міграції токен провайдера лежав у змінних оточення — один на весь
 * застосунок. Для платформи з багатьма викладачами це означало б, що гроші
 * за заняття будь-кого з них надходять на рахунок власника сервера. Тепер
 * кожен викладач підключає свій рахунок сам.
 *
 * Токен — секрет на предʼявника: хто ним володіє, той виставляє рахунки від
 * імені викладача. Тому в базі він лежить ЗАШИФРОВАНИМ (AES-256-GCM), а ключ
 * живе окремо від бази. Навіть маючи дамп, прочитати токени не вийде.
 *
 * `payments.teacher_id` потрібен не для зручності: вебхук перевіряється
 * публічним ключем ТОГО мерчанта, який виставив рахунок. Якщо студент
 * колись перейде до іншого викладача, старий платіж мусить і далі
 * перевірятись ключем старого — тому мерчант фіксується в самому платежі,
 * а не виводиться зі студента в момент обробки.
 */
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table teachers
      add column payment_provider        text
        check (payment_provider in ('monobank')),
      add column payment_token_encrypted text,
      add column payments_connected_at   timestamptz,
      /* підключення — це трійка «провайдер + токен + час», часткових станів немає */
      add constraint teachers_payment_complete check (
        (payment_provider is null and payment_token_encrypted is null
                                  and payments_connected_at is null)
        or
        (payment_provider is not null and payment_token_encrypted is not null
                                      and payments_connected_at is not null)
      )`.execute(db);

  await sql`
    alter table payments
      add column teacher_id integer references teachers(id) on delete restrict`.execute(db);

  // Платежі, створені до поділу на мерчантів, належать єдиному викладачу,
  // якого обслуговував спільний токен.
  await sql`
    update payments p
       set teacher_id = s.teacher_id
      from students s
     where s.id = p.student_id and p.teacher_id is null`.execute(db);

  await sql`create index payments_teacher_time on payments (teacher_id, created_at desc)`
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index if exists payments_teacher_time`.execute(db);
  await sql`alter table payments drop column if exists teacher_id`.execute(db);
  await sql`
    alter table teachers
      drop constraint if exists teachers_payment_complete,
      drop column if exists payment_provider,
      drop column if exists payment_token_encrypted,
      drop column if exists payments_connected_at`.execute(db);
}
