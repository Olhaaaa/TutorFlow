/**
 * Демо-дані для розробки, демонстрації та скріншотів.
 *
 * Запуск: pnpm --filter api seed
 * Скрипт ідемпотентний у тому сенсі, що спершу повністю очищає таблиці —
 * на робочій базі його запускати не можна, і він про це попереджає.
 */
import { hash } from '@node-rs/bcrypt';
import { sql } from 'kysely';
import { createDatabase } from './database.module.js';

const PASSWORD = 'tutorflow';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('відмова: сідер не запускається в продакшні');
    process.exit(1);
  }

  const db = createDatabase();
  const pwd = await hash(PASSWORD, 10);

  await sql`truncate transactions, slots, enrollments, availability_rules, students, teachers
            restart identity cascade`.execute(db);

  const teacher = await db.insertInto('teachers').values({
    name: 'Марія Коваль',
    email: 'teacher@tutorflow.local',
    password_hash: pwd,
    timezone: 'Europe/Kyiv',
    default_price_minor: 50_000,
    cancel_hours: 24,
    payment_deadline_hours: 24,
  }).returning('id').executeTakeFirstOrThrow();

  // Один студент в іншому поясі — інакше помилки з часовими зонами
  // не виявляться ні на демонстрації, ні в тестах.
  const students = await db.insertInto('students').values([
    { teacher_id: teacher.id, name: 'Аня',    email: 'anya@tutorflow.local',  password_hash: pwd, timezone: 'Europe/Kyiv' },
    { teacher_id: teacher.id, name: 'Богдан', email: 'bohdan@tutorflow.local', password_hash: pwd, timezone: 'America/New_York' },
    { teacher_id: teacher.id, name: 'Віра',   email: 'vira@tutorflow.local',   password_hash: pwd, timezone: 'Europe/Kyiv' },
  ]).returning(['id', 'name']).execute();

  const [anya, bohdan, vira] = students;

  // Робочий тиждень викладача: будні з ранку до вечора, субота до обіду.
  // Вікно навмисно широке — на демонстрації має бути видно повну сітку, а не
  // три колонки, і студенти з Америки мусять знаходити собі зручні години.
  const WEEKDAY_HOURS = [
    '08:00', '09:00', '10:00', '11:00',
    '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00',
  ];
  const SATURDAY_HOURS = ['10:00', '11:00', '12:00', '13:00'];

  const rules = [
    ...[1, 2, 3, 4, 5].flatMap((weekday) =>
      WEEKDAY_HOURS.map((startTime) => ({ weekday, startTime })),
    ),
    ...SATURDAY_HOURS.map((startTime) => ({ weekday: 6, startTime })),
  ].map(({ weekday, startTime }) => ({
    teacher_id: teacher.id,
    weekday,
    start_time: startTime,
    duration_min: 60,
    // вечірня година дорожча — заразом видно, що ціна живе у слоті, а не в коді
    price_minor: startTime >= '20:00' ? 60_000 : 50_000,
  }));
  await db.insertInto('availability_rules').values(rules).execute();

  // Слоти на тиждень назад і на чотири вперед. Минулий тиждень потрібен, щоб
  // у демо було що показати в станах «проведено» й «скасовано пізно».
  // Приведення d::date обовʼязкове: без нього AT TIME ZONE спрацює у
  // зворотний бік і час поїде.
  await sql`
    insert into slots (teacher_id, start_at, end_at, price_minor, status)
    select r.teacher_id,
           (d::date + r.start_time) at time zone t.timezone,
           (d::date + r.start_time + make_interval(mins => r.duration_min)) at time zone t.timezone,
           r.price_minor, 'free'
      from availability_rules r
      join teachers t on t.id = r.teacher_id
      cross join generate_series(current_date - 7, current_date + 28, interval '1 day') d
     where r.is_active and extract(dow from d::date) = r.weekday
        on conflict (teacher_id, start_at) do nothing
  `.execute(db);

  // Постійне місце Ані: щосереди о 16:00 за часом викладача.
  const enrollment = await db.insertInto('enrollments').values({
    student_id: anya!.id, weekday: 3, start_time: '16:00',
  }).returning('id').executeTakeFirstOrThrow();

  await sql`
    update slots s
       set status = 'pre_booked', student_id = ${anya!.id}, enrollment_id = ${enrollment.id},
           hold_expires_at = s.start_at - make_interval(hours => t.payment_deadline_hours)
      from teachers t
     where t.id = s.teacher_id and s.status = 'free' and s.start_at > now()
       and extract(dow from s.start_at at time zone t.timezone) = 3
       and (s.start_at at time zone t.timezone)::time = '16:00'
  `.execute(db);

  // Аня оплатила два заняття наперед — конвертуємо два найближчі.
  await db.insertInto('transactions').values({
    student_id: anya!.id, amount_minor: 100_000, kind: 'topup', comment: 'оплата за 2 заняття',
  }).execute();
  await db.updateTable('students').set({ balance_minor: 100_000 })
    .where('id', '=', anya!.id).execute();

  const toPay = await db.selectFrom('slots').select(['id', 'price_minor'])
    .where('student_id', '=', anya!.id).where('status', '=', 'pre_booked')
    .orderBy('start_at').limit(2).execute();

  for (const slot of toPay) {
    await db.updateTable('slots')
      .set({ status: 'booked', paid_at: new Date(), hold_expires_at: null })
      .where('id', '=', slot.id).execute();
    await db.insertInto('transactions').values({
      student_id: anya!.id, amount_minor: -slot.price_minor,
      kind: 'lesson_charge', slot_id: slot.id,
    }).execute();
    await db.updateTable('students')
      .set((eb) => ({ balance_minor: eb('balance_minor', '-', slot.price_minor) }))
      .where('id', '=', anya!.id).execute();
  }

  /* ---------- помічники для демо-броней ---------- */

  const HOUR_AGO = new Date(Date.now() - 3_600_000);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  /** Найближче майбутнє заняття у вказані день тижня й годину за часом викладача. */
  const nextFree = async (weekday: number, time: string) => {
    const r = await sql<{ id: number; price_minor: number }>`
      select s.id, s.price_minor
        from slots s join teachers t on t.id = s.teacher_id
       where s.status = 'free' and s.start_at > now()
         and extract(dow from s.start_at at time zone t.timezone) = ${weekday}
         and (s.start_at at time zone t.timezone)::time = ${time}::time
       order by s.start_at
       limit 1`.execute(db);
    return r.rows[0] ?? null;
  };

  /** Списання разом із записом у журнал: кеш балансу й журнал мусять сходитись. */
  const charge = async (studentId: number, slotId: number, amount: number) => {
    await db.insertInto('transactions').values({
      student_id: studentId, amount_minor: -amount, kind: 'lesson_charge', slot_id: slotId,
    }).execute();
    await db.updateTable('students')
      .set((eb) => ({ balance_minor: eb('balance_minor', '-', amount) }))
      .where('id', '=', studentId).execute();
  };

  const topup = async (studentId: number, amount: number, comment: string, at?: Date) => {
    await db.insertInto('transactions').values({
      student_id: studentId, amount_minor: amount, kind: 'topup', comment,
      // Час указується явно, бо поповнення вноситься після списань, а в
      // журналі мусить стояти перед ними: не можна витратити те, чого ще немає.
      ...(at ? { created_at: at } : {}),
    }).execute();
    await db.updateTable('students')
      .set((eb) => ({ balance_minor: eb('balance_minor', '+', amount) }))
      .where('id', '=', studentId).execute();
  };

  /**
   * Ставить студента на найближче заняття: оплачене або лише закріплене.
   * Повертає списану суму — ціни різні (вечірня година дорожча), і
   * вгадувати їх у голові не можна.
   */
  const take = async (studentId: number, weekday: number, time: string, paid: boolean) => {
    const slot = await nextFree(weekday, time);
    if (!slot) return 0;
    if (paid) {
      await db.updateTable('slots')
        .set({ status: 'booked', student_id: studentId, paid_at: new Date() })
        .where('id', '=', slot.id).execute();
      await charge(studentId, slot.id, slot.price_minor);
      return slot.price_minor;
    } else {
      await sql`
        update slots s
           set status = 'pre_booked', student_id = ${studentId},
               hold_expires_at = s.start_at - make_interval(hours => t.payment_deadline_hours)
          from teachers t
         where t.id = s.teacher_id and s.id = ${slot.id}`.execute(db);
      return 0; // закріплення без оплати коштів не рухає
    }
  };

  /** Минуле заняття: воно вже оплачене, тому paid_at обовʼязковий за схемою. */
  const archive = async (studentId: number, status: 'done' | 'cancelled_late', back: number) => {
    const r = await sql<{ id: number; price_minor: number }>`
      select id, price_minor from slots
       where status = 'free' and start_at < now()
       order by start_at desc
       offset ${back} limit 1`.execute(db);
    const slot = r.rows[0];
    if (!slot) return 0;
    await db.updateTable('slots')
      .set({ status, student_id: studentId, paid_at: new Date() })
      .where('id', '=', slot.id).execute();
    await charge(studentId, slot.id, slot.price_minor);
    return slot.price_minor;
  };

  /* ---------- Богдан: наповнений тиждень на всі стани ---------- */

  // Два закріплені місця лишаються неоплаченими — саме так і працює модель:
  // гроші закінчились, місце тримається до hold_expires_at. Якби балансу
  // вистачало, система конвертувала б їх сама.
  //
  // Поповнення рахується з фактичних списань, а НЕ задається числом: ціни
  // різні, вечірня година коштує 600 ₴, і зашита сума «пʼять по 500» заганяла
  // баланс у мінус — стан, неможливий у цій моделі.
  const bohdanSpent = sum([
    await take(bohdan!.id, 2, '14:00', true),   // вівторок, оплачене
    await take(bohdan!.id, 4, '15:00', true),   // четвер, оплачене
    await take(bohdan!.id, 5, '11:00', true),   // пʼятниця, оплачене
    await archive(bohdan!.id, 'done', 0),            // проведене заняття
    await archive(bohdan!.id, 'cancelled_late', 1),  // скасоване пізно, без повернення
  ]);
  await topup(bohdan!.id, bohdanSpent, 'передоплата за місяць', HOUR_AGO);
  await take(bohdan!.id, 6, '10:00', false);  // субота, лише закріплено
  await take(bohdan!.id, 1, '18:00', false);  // понеділок, лише закріплено

  /* ---------- Віра: чужі заняття, щоб у сітці був стан «зайнято» ---------- */

  const viraSpent = sum([
    await take(vira!.id, 2, '17:00', true),
    await take(vira!.id, 3, '09:00', true),
  ]);
  await topup(vira!.id, viraSpent, 'оплата за 2 заняття', HOUR_AGO);

  // Запобіжник: відʼємний баланс у цій моделі неможливий, і якщо він
  // зʼявився — винні демо-дані, а не користувач. Краще впасти тут.
  const balances = await db.selectFrom('students')
    .select(['name', 'balance_minor']).orderBy('id').execute();
  const broken = balances.filter((b) => b.balance_minor < 0);
  if (broken.length > 0) {
    console.error('сідер зіпсував дані — відʼємний баланс:', broken);
    process.exit(1);
  }

  const counts = await db.selectFrom('slots')
    .select(['status', (eb) => eb.fn.countAll<number>().as('n')])
    .groupBy('status').orderBy('status').execute();

  console.log('\nдемо-дані створено\n');
  console.log(`  викладач: teacher@tutorflow.local`);
  for (const s of [anya, bohdan, vira]) {
    console.log(`  студент:  ${s!.name} — ${s!.name === 'Аня' ? 'anya' : s!.name === 'Богдан' ? 'bohdan' : 'vira'}@tutorflow.local`);
  }
  console.log(`\n  пароль для всіх: ${PASSWORD}\n`);
  console.log('  слоти:', counts.map((c) => `${c.status} ${c.n}`).join(', '));
  console.log('  баланси:', balances.map((b) => `${b.name} ${b.balance_minor / 100} ₴`).join(', '));

  await db.destroy();
}

void main();
