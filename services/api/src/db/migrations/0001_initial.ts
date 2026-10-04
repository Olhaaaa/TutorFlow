/**
 * Початкова схема.
 *
 * CHECK-обмеження тут навмисно строгі: вони переносять інваріанти автомата
 * станів із коду в базу. Якщо якесь із них заблокує законну операцію —
 * це сигнал, що логіка розходиться з моделлю, а не що обмеження зайве.
 *
 * Гроші — integer копійок. Межа ±21 474 836.47 грн на один рядок, чого для
 * практики одного репетитора вистачає з величезним запасом. Якби взяли bigint,
 * драйвер pg віддавав би значення РЯДКОМ, і в грошовій арифметиці зʼявилось би
 * місце для помилки.
 *
 * Генерація слотів із настінного часу — ОБОВʼЯЗКОВО через приведення до date:
 *
 *   (d::date + r.start_time) at time zone t.timezone
 *
 * Без `::date` вираз `d + start_time` дає timestamptz, а `AT TIME ZONE` над
 * timestamptz працює у ЗВОРОТНИЙ бік — переводить у локальний час замість
 * інтерпретувати як локальний. Перевірено: без приведення 16:00 за Києвом
 * перетворюється на 22:00.
 */
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // потрібне для оператора = на integer у GiST-індексі
  await sql`create extension if not exists btree_gist`.execute(db);

  await sql`
    create table teachers (
      id                     serial primary key,
      name                   text not null,
      email                  text not null unique,
      password_hash          text not null,
      timezone               text not null default 'Europe/Kyiv',
      default_price_minor    integer not null check (default_price_minor >= 0),
      cancel_hours           integer not null default 24 check (cancel_hours >= 0),
      payment_deadline_hours integer not null default 24 check (payment_deadline_hours >= 0),
      created_at             timestamptz not null default now()
    )`.execute(db);

  await sql`
    create table students (
      id                 serial primary key,
      teacher_id         integer not null references teachers(id) on delete cascade,
      name               text not null,
      email              text not null unique,
      password_hash      text not null,
      balance_minor      integer not null default 0,
      timezone           text not null,
      telegram_chat_id   bigint,
      telegram_link_code text unique,
      created_at         timestamptz not null default now()
    )`.execute(db);

  await sql`
    create table availability_rules (
      id           serial primary key,
      teacher_id   integer not null references teachers(id) on delete cascade,
      weekday      smallint not null check (weekday between 0 and 6),
      start_time   time not null,
      duration_min integer not null check (duration_min > 0),
      price_minor  integer not null check (price_minor >= 0),
      is_active    boolean not null default true,
      unique (teacher_id, weekday, start_time)
    )`.execute(db);

  await sql`
    create table enrollments (
      id         serial primary key,
      student_id integer not null references students(id) on delete cascade,
      weekday    smallint not null check (weekday between 0 and 6),
      start_time time not null,
      is_active  boolean not null default true,
      created_at timestamptz not null default now()
    )`.execute(db);

  await sql`
    create unique index enrollments_active_place
      on enrollments (student_id, weekday, start_time) where is_active`.execute(db);

  await sql`
    create table slots (
      id              serial primary key,
      teacher_id      integer not null references teachers(id) on delete cascade,
      start_at        timestamptz not null,
      end_at          timestamptz not null,
      period          tstzrange generated always as (tstzrange(start_at, end_at, '[)')) stored,
      price_minor     integer not null check (price_minor >= 0),
      status          text not null default 'free'
                      check (status in ('free','pre_booked','booked','done','cancelled_late')),
      student_id      integer references students(id) on delete set null,
      enrollment_id   integer references enrollments(id) on delete set null,
      hold_expires_at timestamptz,
      paid_at         timestamptz,
      created_at      timestamptz not null default now(),

      constraint slots_period_valid    check (end_at > start_at),
      -- вільний слот без студента, будь-який інший — зі студентом
      constraint slots_student_matches check ((status = 'free') = (student_id is null)),
      -- дедлайн оплати існує рівно для pre_booked
      constraint slots_hold_matches    check ((status = 'pre_booked') = (hold_expires_at is not null)),
      -- оплачено рівно тоді, коли гроші вже списані
      constraint slots_paid_matches
        check ((status in ('booked','done','cancelled_late')) = (paid_at is not null)),

      -- захист від дублікатів при повторній генерації
      unique (teacher_id, start_at)
    )`.execute(db);

  // Головне обмеження моделі: заняття викладача не перетинаються.
  // Вільні слоти перетинатись МОЖУТЬ — це альтернативні пропозиції на ту саму годину.
  await sql`
    alter table slots add constraint slots_no_overlap
      exclude using gist (teacher_id with =, period with &&)
      where (status <> 'free')`.execute(db);

  await sql`
    create index slots_student_status on slots (student_id, status)
      where student_id is not null`.execute(db);
  await sql`
    create index slots_hold_expiry on slots (hold_expires_at)
      where status = 'pre_booked'`.execute(db);

  await sql`
    create table transactions (
      id           serial primary key,
      student_id   integer not null references students(id) on delete cascade,
      amount_minor integer not null check (amount_minor <> 0),
      kind         text not null check (kind in ('topup','lesson_charge','refund','adjustment')),
      slot_id      integer references slots(id) on delete set null,
      comment      text,
      created_at   timestamptz not null default now(),

      -- знак суми мусить відповідати типу операції
      constraint transactions_sign_matches check (
           (kind = 'topup'         and amount_minor > 0)
        or (kind = 'lesson_charge' and amount_minor < 0)
        or (kind = 'refund'        and amount_minor > 0)
        or (kind = 'adjustment')
      )
    )`.execute(db);

  await sql`
    create index transactions_student_time
      on transactions (student_id, created_at desc)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['transactions', 'slots', 'enrollments', 'availability_rules', 'students', 'teachers']) {
    await sql`drop table if exists ${sql.raw(t)} cascade`.execute(db);
  }
}
