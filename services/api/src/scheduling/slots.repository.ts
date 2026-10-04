import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { KYSELY, type Database } from '../db/database.module.js';
import type { DB, SlotStatusColumn } from '../db/schema.js';

export type Executor = Kysely<DB> | Transaction<DB>;

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
    const patch =
      to === 'free'
        ? { status: 'free' as const, student_id: null, hold_expires_at: null, paid_at: null }
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
   * Календар на період. Повертає слоти викладача, а не лише вільні:
   * чужі заняття потрібні, щоб показати їх як busy без імені студента.
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
