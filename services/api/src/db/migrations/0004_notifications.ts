/**
 * Журнал нагадувань — перший споживач шини подій.
 *
 * Досі студент дізнавався про те, що викладач скасував заняття, лише відкривши
 * застосунок. Канал доставки (Telegram) ще не підключений, але таблиця
 * потрібна вже зараз, і не як заготовка: саме вона робить споживача подій
 * ідемпотентним.
 *
 * `dedup_key unique` — ось ця гарантія. Redis Streams дає at-least-once:
 * споживач, який упав між обробкою й `XACK`, отримає повідомлення повторно.
 * Якби дедуплікація жила в коді споживача, два паралельні екземпляри (а в
 * лабораторній 4 їх множить KEDA) однаково надіслали б два нагадування.
 * Унікальний індекс у базі витримує і повтор, і одночасність.
 *
 * `channel` і `sent_at` заповнюються ПАРОЮ: нагадування або доставлене якимось
 * каналом у якийсь момент, або ні. Той самий прийом, що й у трійці платіжних
 * реквізитів викладача, — часткових станів у базі не існує.
 */
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table notifications (
      id          bigserial primary key,
      student_id  integer not null references students(id) on delete cascade,
      /* тип події, з якої нагадування народилось */
      kind        text    not null,
      /* готовий текст: він належить домену, а не каналу */
      text        text    not null,
      /* подія як є — щоб канал міг дібрати подробиці без нового походу в базу */
      payload     jsonb   not null,
      /* ідемпотентність споживача: повторна доставка події не створить другого рядка */
      dedup_key   text    not null unique,
      created_at  timestamptz not null default now(),
      channel     text,
      sent_at     timestamptz,
      constraint notifications_delivery_complete check ((channel is null) = (sent_at is null))
    )`.execute(db);

  // Для екрана студента й для вибірки недоставлених: обидва запроси йдуть
  // хронологічно, тому індекс один.
  await sql`
    create index notifications_student_time on notifications (student_id, created_at desc)`
    .execute(db);

  await sql`
    create index notifications_pending on notifications (created_at) where sent_at is null`
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists notifications`.execute(db);
}
