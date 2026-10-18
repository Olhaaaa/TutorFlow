import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KYSELY, type Database, type Executor } from '../db/database.module.js';
import type { SlotStatusColumn } from '../db/schema.js';

/** Чим слот стає при захопленні. Поля різні, бо різні інваріанти в базі. */
export type ClaimOutcome =
  | { status: 'booked'; paidAt: Date }
  | { status: 'pre_booked'; holdExpiresAt: Date };

@Injectable()
export class SlotsRepository {
  constructor(@Inject(KYSELY) private readonly root: Database) {}

  private db(tx?: Executor): Executor {
    return tx ?? this.root;
  }

  /**
   * АТОМАРНЕ захоплення вільного слота.
   *
   * Умова `status = 'free'` стоїть ВСЕРЕДИНІ UPDATE, а не в окремому SELECT.
   * Між читанням і записом встигає пройти інший запрос, тому перевірка в коді
   * не захищає — захищає те, що база серіалізує одночасні UPDATE одного рядка.
   *
   * @returns рядок слота, якщо захопили; null якщо хтось випередив → 409.
   */
  async claimFree(
    slotId: number,
    studentId: number,
    outcome: ClaimOutcome,
    tx?: Executor,
  ) {
    const row = await this.db(tx)
      .updateTable('slots')
      .set(
        outcome.status === 'booked'
          ? { status: 'booked', student_id: studentId, paid_at: outcome.paidAt }
          : {
              status: 'pre_booked',
              student_id: studentId,
              hold_expires_at: outcome.holdExpiresAt,
            },
      )
      .where('id', '=', slotId)
      .where('status', '=', 'free')
      .returningAll()
      .executeTakeFirst();

    return row ?? null;
  }

  /**
   * Перевести слот у вказаний стан, лише якщо він досі у стані `from`.
   * Та сама ідея, що в claimFree: умова всередині UPDATE робить операцію
   * ідемпотентною, тому повторний виклик нічого не зіпсує.
   */
  async transition(
    slotId: number,
    from: SlotStatusColumn,
    to: 'free' | 'cancelled_late' | 'done',
    tx?: Executor,
  ) {
    // Звільнений слот не повинен тягнути за собою посилання на закріплення:
    // інакше наступний студент, який його візьме, опиниться привʼязаним до
    // чужого постійного місця, і зняття того закріплення звільнило б його
    // заняття.
    const patch =
      to === 'free'
        ? {
            status: 'free' as const,
            student_id: null,
            enrollment_id: null,
            hold_expires_at: null,
            paid_at: null,
          }
        : { status: to, hold_expires_at: null };

    const row = await this.db(tx)
      .updateTable('slots')
      .set(patch)
      .where('id', '=', slotId)
      .where('status', '=', from)
      .returningAll()
      .executeTakeFirst();

    return row ?? null;
  }

  async byId(slotId: number, tx?: Executor) {
    return (
      (await this.db(tx)
        .selectFrom('slots')
        .selectAll()
        .where('id', '=', slotId)
        .executeTakeFirst()) ?? null
    );
  }

  /**
   * Календар на період. Повертає слоти викладача, а не лише вільні: чужі
   * заняття потрібні, щоб показати їх як busy без імені студента.
   *
   * Імені студента тут немає й не буде: `students` належить білінгу, і
   * підписує заняття довідник (StudentDirectoryPort), а не `join`. Той самий
   * рядок віддається і студентському календарю, і кабінету викладача.
   */
  async inRange(teacherId: number, from: Date, to: Date, tx?: Executor) {
    return this.db(tx)
      .selectFrom('slots')
      .select([
        'id', 'start_at', 'end_at', 'price_minor', 'status',
        'student_id', 'hold_expires_at',
      ])
      .where('teacher_id', '=', teacherId)
      .where('start_at', '>=', from)
      .where('start_at', '<', to)
      .orderBy('start_at')
      .execute();
  }

  /**
   * ЄДИНА функція доступності: які слоти викладача вільні насправді.
   *
   * «Насправді» означає з урахуванням зайнятості поза нашим розкладом. Доки
   * всі питання «чи вільна ця година» йдуть через цей запрос, інтеграція з
   * чужим календарем лишається однією таблицею й одним `not exists` — а не
   * правкою в кожному місці, де хтось вирішив сам порівняти час.
   *
   * Перетин перевіряється оператором `&&` по `tstzrange`, тому працює
   * GiST-індекс, а не послідовний перебір. Інтервал напіввідкритий `[)`:
   * заняття, що починається рівно тоді, коли закінчується зовнішня подія,
   * конфліктом НЕ є.
   */
  async availableSlots(teacherId: number, from: Date, to: Date, tx?: Executor) {
    const [free, blocked] = await Promise.all([
      this.db(tx)
        .selectFrom('slots')
        .select(['id', 'start_at', 'end_at', 'price_minor'])
        .where('teacher_id', '=', teacherId)
        .where('status', '=', 'free')
        .where('start_at', '>=', from)
        .where('start_at', '<', to)
        .orderBy('start_at')
        .execute(),
      this.blockedByExternal(teacherId, from, to, tx),
    ]);

    // Предикат «зайнято зовнішнім» живе РІВНО в одному запросі —
    // blockedByExternal. Написати той самий `exists` ще й тут означало б
    // одразу зламати те, заради чого ця функція й існує: щоб правило
    // доступності було одне. Ціна — два звернення замість одного; для вікна
    // календаря це нічого не варте.
    return free.filter((slot) => !blocked.has(slot.id));
  }

  /**
   * Ті самі слоти, але лише ідентифікатори зайнятих зовнішнім: календар
   * студента показує їх як зайняті, а не ховає. Ховати було б гірше — слот
   * зник би з сітки без причини.
   */
  async blockedByExternal(teacherId: number, from: Date, to: Date, tx?: Executor) {
    const rows = await this.db(tx)
      .selectFrom('slots')
      .select('slots.id')
      .where('teacher_id', '=', teacherId)
      .where('status', '=', 'free')
      .where('start_at', '>=', from)
      .where('start_at', '<', to)
      .where((eb) =>
        eb.exists(
          eb.selectFrom('external_busy')
            .select('external_busy.id')
            .whereRef('external_busy.teacher_id', '=', 'slots.teacher_id')
            .where(sql<boolean>`external_busy.period && slots.period`),
        ))
      .execute();

    return new Set(rows.map((r) => r.id));
  }

  /** Заняття викладача для стрічки календаря: лише зайняті години. */
  async forCalendar(teacherId: number, from: Date, to: Date, tx?: Executor) {
    return this.db(tx)
      .selectFrom('slots')
      .select(['id', 'start_at', 'end_at', 'status', 'student_id'])
      .where('teacher_id', '=', teacherId)
      .where('status', 'in', ['pre_booked', 'booked', 'done', 'cancelled_late'])
      .where('start_at', '>=', from)
      .where('start_at', '<', to)
      .orderBy('start_at')
      .execute();
  }

  /**
   * Заняття студента для його стрічки `.ics`.
   *
   * Фільтр по `student_id`, а не по викладачеві: у стрічку студента не має
   * потрапити жодне чуже заняття, навіть як «зайнято». Сам стовпець і робить
   * цю гарантію — забути умову тут неможливо, запит просто поверне порожньо.
   */
  async forStudentCalendar(studentId: number, from: Date, to: Date, tx?: Executor) {
    return this.db(tx)
      .selectFrom('slots')
      .innerJoin('teachers', 'teachers.id', 'slots.teacher_id')
      .select([
        'slots.id as id', 'slots.start_at as start_at', 'slots.end_at as end_at',
        'slots.status as status', 'teachers.name as teacher_name',
      ])
      .where('slots.student_id', '=', studentId)
      .where('slots.status', 'in', ['pre_booked', 'booked', 'done', 'cancelled_late'])
      .where('slots.start_at', '>=', from)
      .where('slots.start_at', '<', to)
      .orderBy('slots.start_at')
      .execute();
  }

  /** Неоплачені слоти студента в ХРОНОЛОГІЧНОМУ порядку — саме так їх конвертує білінг. */
  async pendingPayment(studentId: number, tx?: Executor) {
    return this.db(tx)
      .selectFrom('slots')
      .select(['id', 'start_at', 'price_minor'])
      .where('student_id', '=', studentId)
      .where('status', '=', 'pre_booked')
      .orderBy('start_at')
      .execute();
  }

  /**
   * Генерація слотів із тижневого шаблону.
   *
   * Приведення `d::date` обовʼязкове. `generate_series` від дат віддає
   * timestamptz, а `AT TIME ZONE` над timestamptz працює у ЗВОРОТНИЙ бік —
   * переводить у локальний час замість інтерпретувати як локальний.
   * Без приведення 16:00 за Києвом стає 22:00.
   *
   * Так переходи на зимовий і літній час враховуються для КОЖНОГО входження
   * окремо, бо PostgreSQL бере їх із tzdata.
   */
  async generateFromRules(teacherId: number, from: Date, to: Date, tx?: Executor) {
    const result = await sql<{ id: number }>`
      insert into slots (teacher_id, start_at, end_at, price_minor, status)
      select r.teacher_id,
             (d::date + r.start_time) at time zone t.timezone,
             (d::date + r.start_time + make_interval(mins => r.duration_min))
               at time zone t.timezone,
             r.price_minor,
             'free'
        from availability_rules r
        join teachers t on t.id = r.teacher_id
        cross join generate_series(${from}::date, ${to}::date, interval '1 day') d
       where r.teacher_id = ${teacherId}
         and r.is_active
         and extract(dow from d::date) = r.weekday
          on conflict (teacher_id, start_at) do nothing
      returning id
    `.execute(this.db(tx));

    return result.rows.length;
  }

  /**
   * АТОМАРНА конвертація закріплення в оплачене заняття.
   *
   * Умова `status = 'pre_booked'` усередині UPDATE — захист від подвійного
   * списання: якщо викладач двічі швидко натисне «поповнити», два обробники
   * підуть конвертувати ті самі слоти, і другий отримає нуль рядків.
   */
  async convertToBooked(slotId: number, paidAt: Date, tx?: Executor) {
    const row = await this.db(tx)
      .updateTable('slots')
      .set({ status: 'booked', paid_at: paidAt, hold_expires_at: null })
      .where('id', '=', slotId)
      .where('status', '=', 'pre_booked')
      .returningAll()
      .executeTakeFirst();

    return row ?? null;
  }

  /** Звільнити прострочені закріплення. Фонова задача з лабораторної 2. */
  async expireHolds(now: Date, tx?: Executor) {
    const rows = await this.db(tx)
      .updateTable('slots')
      .set({ status: 'free', student_id: null, hold_expires_at: null })
      .where('status', '=', 'pre_booked')
      .where('hold_expires_at', '<=', now)
      .returning(['id', 'student_id'])
      .execute();
    return rows;
  }

  /**
   * Закріпити за студентом усі МАЙБУТНІ вільні слоти, що відповідають його
   * постійному місцю в розкладі. Порівняння йде за локальним часом викладача,
   * тому після переходу на зимовий час «щосереди о 16:00» лишається 16:00.
   *
   * Якщо якийсь зі слотів перетинається з уже зайнятим, UPDATE впаде на
   * slots_no_overlap — і це правильна поведінка: тримати місце, що накладається
   * на інше заняття, не можна.
   */
  async claimForEnrollment(
    params: { enrollmentId: number; studentId: number; teacherId: number; weekday: number; startTime: string },
    tx?: Executor,
  ) {
    const res = await sql<{ id: number }>`
      update slots s
         set status = 'pre_booked',
             student_id = ${params.studentId},
             enrollment_id = ${params.enrollmentId},
             hold_expires_at = s.start_at - make_interval(hours => t.payment_deadline_hours)
        from teachers t
       where t.id = s.teacher_id
         and s.teacher_id = ${params.teacherId}
         and s.status = 'free'
         and s.start_at > now()
         and extract(dow from s.start_at at time zone t.timezone) = ${params.weekday}
         and (s.start_at at time zone t.timezone)::time = ${params.startTime}::time
      returning s.id
    `.execute(this.db(tx));
    return res.rows.length;
  }

  /**
   * Прибрати майбутні ВІЛЬНІ слоти цієї години шаблону.
   *
   * Зайняті не чіпаються взагалі — ні заброньовані, ні закріплені, ні
   * проведені. Прибрати годину з шаблону означає «більше її не продавай», а
   * не «скасуй те, на що люди вже записались»: про записані заняття викладач
   * домовляється зі студентом, і робити це за нього застосунок не має права.
   *
   * День тижня й час рахуються в зоні ВИКЛАДАЧА тим самим виразом, що й
   * генерація, — інакше після переходу на зимовий час видалялась би сусідня
   * година.
   */
  async deleteFreeByRule(
    params: { teacherId: number; weekday: number; startTime: string },
    tx?: Executor,
  ) {
    const res = await sql<{ id: number }>`
      delete from slots s
       using teachers t
       where t.id = s.teacher_id
         and s.teacher_id = ${params.teacherId}
         and s.status = 'free'
         and s.start_at > now()
         and extract(dow from s.start_at at time zone t.timezone) = ${params.weekday}
         and (s.start_at at time zone t.timezone)::time = ${params.startTime}::time
      returning s.id
    `.execute(this.db(tx));
    return res.rows.length;
  }

  /** Зняти закріплення: майбутні неоплачені слоти знову стають вільними. */
  async releaseEnrollmentSlots(enrollmentId: number, tx?: Executor) {
    const rows = await this.db(tx)
      .updateTable('slots')
      .set({ status: 'free', student_id: null, enrollment_id: null, hold_expires_at: null })
      .where('enrollment_id', '=', enrollmentId)
      .where('status', '=', 'pre_booked')
      .where('start_at', '>', new Date())
      .returning(['id'])
      .execute();
    return rows.length;
  }

  /**
   * Заняття, до початку яких лишилось приблизно добу.
   *
   * Беруться `booked` і `pre_booked`: нагадати треба і про оплачене заняття
   * (щоб людина не забула прийти), і про неоплачене (щоб устигла заплатити).
   * `done` і `cancelled_late` не беруться — нагадувати про те, що вже
   * скінчилось, нема сенсу.
   */
  async upcomingForReminder(
    teacherIds: readonly number[],
    from: Date,
    to: Date,
    tx?: Executor,
  ) {
    if (teacherIds.length === 0) return [];
    return this.db(tx)
      .selectFrom('slots')
      .select(['id', 'student_id', 'start_at', 'status', 'price_minor'])
      .where('teacher_id', 'in', [...teacherIds])
      .where('status', 'in', ['booked', 'pre_booked'])
      .where('student_id', 'is not', null)
      .where('start_at', '>=', from)
      .where('start_at', '<=', to)
      .orderBy('start_at')
      .execute();
  }

  /**
   * Закріплення, у яких за добу спливає строк оплати.
   *
   * Вікно накладається на `hold_expires_at`, а не на початок заняття: саме
   * цей момент звільняє місце, і саме до нього студентові треба встигнути.
   */
  async paymentDueForReminder(
    teacherIds: readonly number[],
    from: Date,
    to: Date,
    tx?: Executor,
  ) {
    if (teacherIds.length === 0) return [];
    return this.db(tx)
      .selectFrom('slots')
      .select(['id', 'student_id', 'start_at', 'hold_expires_at', 'price_minor'])
      .where('teacher_id', 'in', [...teacherIds])
      .where('status', '=', 'pre_booked')
      .where('student_id', 'is not', null)
      .where('hold_expires_at', '>=', from)
      .where('hold_expires_at', '<=', to)
      .orderBy('hold_expires_at')
      .execute();
  }

  /** Закрити проведені заняття. Фонова задача з лабораторної 2. */
  async completePast(now: Date, tx?: Executor) {
    const rows = await this.db(tx)
      .updateTable('slots')
      .set({ status: 'done' })
      .where('status', '=', 'booked')
      .where('end_at', '<=', now)
      .returning(['id'])
      .execute();
    return rows;
  }
}
