/**
 * Платежі через зовнішнього провайдера (еквайринг monobank).
 *
 * Таблиця існує заради однієї властивості: **вебхук провайдера приходить
 * більше одного разу**. Це не збій, а штатна поведінка — провайдер повторює
 * доставку, доки не отримає 2xx, і цілком може надіслати той самий статус
 * двічі паралельно. Тому зарахування коштів мусить бути привʼязане не до
 * факту «прийшов вебхук», а до факту «цей рядок уперше перейшов у paid».
 *
 * Звідси два обмеження:
 *   1. unique (provider, provider_payment_id) — один платіж провайдера
 *      породжує рівно один наш рядок;
 *   2. перехід у `paid` робиться через UPDATE … WHERE status <> 'paid'
 *      RETURNING: база сама серіалізує одночасні спроби на рівні рядка, і
 *      переможець рівно один. Той самий прийом, що й у захопленні слота.
 *
 * `transaction_id` — слід у журналі: якщо гроші зараховано, тут обовʼязково
 * лежить посилання на транзакцію. Перевіряється обмеженням, бо платіж без
 * проводки означав би помилку в коді, а не рідкісний випадок.
 *
 * Суми — копійки цілим числом, як і всюди в проєкті. Для monobank це ще й
 * збіг із його API: він теж приймає `amount` у копійках, тому конвертації
 * немає взагалі.
 */
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table payments (
      id                  serial primary key,
      student_id          integer not null references students(id) on delete cascade,
      provider            text not null check (provider in ('monobank')),
      /* ідентифікатор на боці провайдера; зʼявляється після створення рахунку */
      provider_payment_id text,
      amount_minor        integer not null check (amount_minor > 0),
      status              text not null default 'pending'
                          check (status in ('pending','paid','failed','expired')),
      page_url            text,
      /* останнє тіло вебхука — для розбору суперечок і для звіту */
      raw                 jsonb,
      /*
       * RESTRICT, а не SET NULL: занулити це поле нижче за перевіркою
       * payments_paid_has_transaction однаково не можна, тож обіцяти
       * нічого не варто. Журнал операцій append-only — рядки з нього не
       * видаляються взагалі, і база це тепер стверджує.
       */
      transaction_id      integer references transactions(id) on delete restrict,
      created_at          timestamptz not null default now(),
      updated_at          timestamptz not null default now(),

      /* оплачений платіж без проводки в журналі — це помилка, а не стан */
      constraint payments_paid_has_transaction
        check ((status = 'paid') = (transaction_id is not null))
    )`.execute(db);

  // Один платіж провайдера — один наш рядок. NULL до створення рахунку
  // обмеженню не заважає: у PostgreSQL NULL-и в unique вважаються різними.
  await sql`
    create unique index payments_provider_ref
      on payments (provider, provider_payment_id)
      where provider_payment_id is not null`.execute(db);

  await sql`
    create index payments_student_time
      on payments (student_id, created_at desc)`.execute(db);

  // Незавершені платежі доводиться перебирати фоновій задачі, яка їх протерміновує.
  await sql`
    create index payments_pending
      on payments (created_at)
      where status = 'pending'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists payments cascade`.execute(db);
}
