import { randomBytes } from 'node:crypto';
import {
  BadRequestException, ConflictException, Inject, Injectable,
  NotFoundException, ForbiddenException,
} from '@nestjs/common';
import {
  bookRejection, cancelOutcome, holdDeadline, LessonAlreadyStartedError, minor,
  NothingToCancelError, rescheduleRejection, slotsCoveredBy, teacherCancelOutcome,
  type TeacherCancelOutcome,
} from '@tutorflow/core';
import { config } from '../config.js';
import { KYSELY, type Database, type Executor } from '../db/database.module.js';
import { EventBus } from '../events/event-bus.js';
import { OUTBOX_FLUSH, type OutboxFlush } from '../outbox/flush.js';
import { AvailabilityRepository } from './availability.repository.js';
import { ExternalBusyRepository } from './external-busy.repository.js';
import { buildCalendar, type CalendarEvent } from './ics.js';
import {
  CHARGE_PORT, STUDENT_DIRECTORY, type ChargePort, type StudentDirectoryPort,
} from './ports.js';
import { SlotsRepository } from './slots.repository.js';
import { TeachersRepository } from './teachers.repository.js';
import { toViewState, type SlotView, type TeacherSlotView } from './slot-view.js';

/** Контекст автентифікованого студента. Заповнює guard автентифікації. */
export interface StudentContext {
  id: number;
  teacherId: number;
}

@Injectable()
export class SchedulingService {
  constructor(
    @Inject(KYSELY) private readonly db: Database,
    private readonly slots: SlotsRepository,
    private readonly teachers: TeachersRepository,
    private readonly availability: AvailabilityRepository,
    @Inject(CHARGE_PORT) private readonly charge: ChargePort,
    private readonly events: EventBus,
    private readonly externalBusy: ExternalBusyRepository,
    @Inject(STUDENT_DIRECTORY) private readonly students: StudentDirectoryPort,
    @Inject(OUTBOX_FLUSH) private readonly outbox: OutboxFlush,
  ) {}

  /**
   * Розклад очима викладача: сирий статус і хто записаний.
   *
   * Імена беруться ДРУГИМ запросом через довідник, а не `join`-ом до
   * `students`: таблиця студентів належить білінгу. Ціна — один зайвий
   * запрос на екран, і вона свідома: `join` до чужої таблиці — рівно те, що
   * неможливо виконати, коли база в сусіда.
   */
  async teacherCalendar(teacherId: number, from: Date, to: Date): Promise<TeacherSlotView[]> {
    const rows = await this.slots.inRange(teacherId, from, to);
    const names = await this.students.namesByIds(
      [...new Set(rows.map((r) => r.student_id).filter((id): id is number => id !== null))],
    );

    return rows.map((r) => ({
      id: r.id,
      startAt: new Date(r.start_at).toISOString(),
      endAt: new Date(r.end_at).toISOString(),
      priceMinor: r.price_minor,
      status: r.status,
      student: r.student_id === null
        ? null
        : { id: r.student_id, name: names.get(r.student_id) ?? '—' },
      payBy: r.hold_expires_at ? new Date(r.hold_expires_at).toISOString() : null,
    }));
  }

  /**
   * Календар очима студента.
   *
   * Вільний слот, що накладається на зайнятість викладача ПОЗА нашим
   * розкладом, показується як `busy`, а не ховається: слот, який зник із
   * сітки без причини, читається як поломка. Саме тут і проходить межа
   * інтеграції з чужим календарем — одна перевірка, а не правка в кожному
   * місці, де хтось порівнює час.
   */
  async calendar(
    teacherId: number,
    from: Date,
    to: Date,
    viewerStudentId: number | null,
  ): Promise<SlotView[]> {
    const [rows, blocked] = await Promise.all([
      this.slots.inRange(teacherId, from, to),
      this.slots.blockedByExternal(teacherId, from, to),
    ]);

    return rows.map((r) => ({
      id: r.id,
      startAt: new Date(r.start_at).toISOString(),
      endAt: new Date(r.end_at).toISOString(),
      priceMinor: r.price_minor,
      state: blocked.has(r.id)
        ? 'busy'
        : toViewState(r.status, r.student_id, viewerStudentId),
      payBy:
        r.student_id === viewerStudentId && r.hold_expires_at
          ? new Date(r.hold_expires_at).toISOString()
          : null,
    }));
  }

  /**
   * Перенесення заняття студентом на інший вільний слот.
   *
   * Чому це ОДНА операція, а не «скасувати й забронювати»: між двома
   * викликами місце встигають забрати, і студент лишається без заняття
   * взагалі. Тут обидві зміни слотів і обидві проводки — в одній транзакції,
   * тому або перенос відбувся, або не змінилось нічого.
   *
   * Гроші рухаються парою `refund` + `lesson_charge`, а не лишаються на
   * старому слоті. Сума та сама, баланс не змінюється — але журнал лишається
   * правдивим: за кожним заняттям видно власне списання, а не посилання на
   * слот, якого студент уже не відвідає.
   */
  async reschedule(slotId: number, toSlotId: number, student: StudentContext, now = new Date()) {
    if (slotId === toSlotId) throw new BadRequestException('це той самий слот');

    const [from, to] = await Promise.all([
      this.slots.byId(slotId),
      this.slots.byId(toSlotId),
    ]);

    if (!from || from.teacher_id !== student.teacherId) {
      throw new NotFoundException('заняття не знайдено');
    }
    if (!to || to.teacher_id !== student.teacherId) {
      throw new NotFoundException('слот не знайдено');
    }
    // Порядок перевірок важливий для ПОВІДОМЛЕННЯ. Вільний слот не належить
    // нікому, тому «це не ваше заняття» про нього збрехало б: насправді
    // переносити нічого. Такий випадок трапляється щоразу, коли повторюють
    // запрос після успішного переносу.
    if (from.student_id === null) throw new BadRequestException('переносити нічого');
    if (from.student_id !== student.id) throw new ForbiddenException('це не ваше заняття');

    const teacher = await this.teachers.byId(from.teacher_id);
    if (!teacher) throw new NotFoundException('викладача не знайдено');

    const rejection = rescheduleRejection(
      { status: from.status, startAt: new Date(from.start_at) },
      { status: to.status, startAt: new Date(to.start_at) },
      now,
      teacher.cancel_hours,
    );
    if (rejection === 'nothing_to_move') throw new BadRequestException('переносити нічого');
    if (rejection === 'target_not_free') throw new ConflictException('цей слот уже зайнятий');
    if (rejection === 'target_in_the_past') throw new BadRequestException('слот у минулому');
    if (rejection === 'too_late') {
      throw new BadRequestException(
        `перенести можна не пізніше ніж за ${teacher.cancel_hours} годин до заняття`,
      );
    }

    // Та сама перевірка доступності, що й у календарі: година, у яку викладач
    // зайнятий поза нашим розкладом, не стає вільною від того, що на неї
    // переносять, а не бронюють.
    const blocked = await this.slots.blockedByExternal(
      from.teacher_id, new Date(to.start_at), new Date(to.end_at),
    );
    if (blocked.has(to.id)) throw new ConflictException('викладач у цей час зайнятий');

    const wasPaid = from.status === 'booked';

    const result = await this.db.transaction().execute(async (tx) => {
      const released = await this.slots.transition(slotId, from.status, 'free', tx);
      if (!released) throw new ConflictException('стан заняття щойно змінився');

      const claimed = wasPaid
        ? await this.slots.claimFree(toSlotId, student.id, { status: 'booked', paidAt: now }, tx)
        : await this.slots.claimFree(
            toSlotId, student.id,
            {
              status: 'pre_booked',
              // Дедлайн оплати рахується від НОВОГО початку: перенос на
              // пізніший час дає більше часу заплатити, і це правильно.
              holdExpiresAt: holdDeadline(new Date(to.start_at), teacher.payment_deadline_hours),
            },
            tx,
          );
      if (!claimed) throw new ConflictException('слот щойно забрали');

      if (wasPaid) {
        await this.charge.refundForLesson(tx, student.id, slotId, from.price_minor);
        await this.charge.chargeForLesson(tx, student.id, toSlotId, to.price_minor);
      }

      return {
        from: slotId,
        to: claimed.id,
        status: claimed.status,
        paid: wasPaid,
        payBy: claimed.hold_expires_at ? new Date(claimed.hold_expires_at).toISOString() : null,
      };
    });

    // Повернення за старий слот і списання за новий — два рядки журналу, і
    // доставити їх треба саме в цьому порядку, інакше між ними зʼявиться мить
    // з боргом, якого насправді немає.
    await this.outbox.flush();
    return result;
  }

  /* ---------- зайнятість поза розкладом і стрічка календаря ---------- */

  listExternalBusy(teacherId: number, from: Date, to: Date) {
    return this.externalBusy.list(teacherId, from, to);
  }

  /**
   * Додати інтервал зайнятості. Наявні заняття НЕ скасовуються: вирішувати,
   * що робити з уже записаним студентом, має людина, а не фонова перевірка.
   */
  async addExternalBusy(
    teacherId: number,
    busy: { startAt: Date; endAt: Date; title?: string | null },
  ) {
    if (busy.endAt.getTime() <= busy.startAt.getTime()) {
      throw new BadRequestException('кінець інтервалу мусить бути після початку');
    }
    return this.externalBusy.upsert(teacherId, busy);
  }

  async removeExternalBusy(teacherId: number, id: number) {
    const row = await this.externalBusy.remove(id, teacherId);
    if (!row) throw new NotFoundException('інтервал не знайдено');
    return { id: row.id };
  }

  /** Вільні години з урахуванням зовнішньої зайнятості — та сама одна функція. */
  async availableSlots(teacherId: number, from: Date, to: Date) {
    const rows = await this.slots.availableSlots(teacherId, from, to);
    return rows.map((r) => ({
      id: r.id,
      startAt: new Date(r.start_at).toISOString(),
      endAt: new Date(r.end_at).toISOString(),
      priceMinor: r.price_minor,
    }));
  }

  /**
   * Адреса стрічки. Токен створюється при першому зверненні й більше не
   * змінюється — інакше та адреса, яку викладач уже вставив у календар,
   * перестала б працювати після кожного відкриття екрана.
   *
   * Повна адреса збирається з `PUBLIC_BASE_URL`: календарю потрібен
   * абсолютний URL, а відносного він не зрозуміє. Без зовнішньої адреси
   * віддається лише шлях — локально його однаково вставляти нікуди.
   */
  async calendarLink(teacherId: number) {
    const row = await this.teachers.ensureCalendarToken(teacherId, randomBytes(24).toString('base64url'));
    if (!row?.calendar_token) throw new NotFoundException('викладача не знайдено');

    const path = `/api/calendar/${row.calendar_token}.ics`;
    return {
      path,
      url: config.publicBaseUrl ? new URL(path, config.publicBaseUrl).toString() : null,
    };
  }

  async revokeCalendarLink(teacherId: number) {
    await this.teachers.clearCalendarToken(teacherId);
    return { revoked: true };
  }

  /**
   * Стрічка `.ics` для календаря викладача.
   *
   * Віддаються зайняті години, включно зі скасованими пізно: останні
   * позначаються `CANCELLED`, і календар прибирає їх сам. Вікно обмежене —
   * стрічку перечитують цілком, і віддавати в ній усю історію немає за чим.
   */
  async calendarFeed(token: string, now = new Date()) {
    const teacher = await this.teachers.byCalendarToken(token);
    if (!teacher) throw new NotFoundException('стрічку не знайдено');

    const from = new Date(now.getTime() - 30 * 86_400_000);
    const to = new Date(now.getTime() + 180 * 86_400_000);
    const rows = await this.slots.forCalendar(teacher.id, from, to);
    const names = await this.students.namesByIds(
      [...new Set(rows.map((r) => r.student_id).filter((id): id is number => id !== null))],
    );

    const events: CalendarEvent[] = rows.map((r) => ({
      slotId: r.id,
      startAt: new Date(r.start_at),
      endAt: new Date(r.end_at),
      summary: r.student_id !== null && names.get(r.student_id)
        ? `Заняття: ${names.get(r.student_id)}`
        : 'Заняття',
      description: r.status === 'pre_booked' ? 'Не оплачене' : undefined,
      cancelled: r.status === 'cancelled_late',
    }));

    return buildCalendar(events, `Tutorflow — ${teacher.name}`, now);
  }

  /* ---------- стрічка студента ---------- */

  /**
   * Адреса стрічки студента. Повторює викладацьку свідомо: токен створюється
   * при першому зверненні й далі не змінюється, бо адресу вже вставлено в
   * чужу програму.
   *
   * Окремий токен, а не спільний із викладачем: у стрічці студента лише його
   * заняття, і відкликати її він мусить уміти сам, не чіпаючи нічиєї іншої.
   */
  async studentCalendarLink(studentId: number) {
    const row = await this.students.ensureCalendarToken(studentId);
    if (!row) throw new NotFoundException('студента не знайдено');

    const path = `/api/calendar/student/${row.calendarToken}.ics`;
    return {
      path,
      url: config.publicBaseUrl ? new URL(path, config.publicBaseUrl).toString() : null,
    };
  }

  async revokeStudentCalendarLink(studentId: number) {
    await this.students.clearCalendarToken(studentId);
    return { revoked: true };
  }

  /**
   * Стрічка `.ics` для календаря студента.
   *
   * Назва події — імʼя ВИКЛАДАЧА: у календарі студента «Заняття: Марія» несе
   * зміст, а власне імʼя не несе жодного. Неоплачене заняття підписане, щоб
   * нагадування приходило не лише від нас.
   *
   * Вікно те саме, що й у викладача: стрічку перечитують цілком, і віддавати
   * в ній усю історію немає за чим.
   */
  async studentCalendarFeed(token: string, now = new Date()) {
    const student = await this.students.byCalendarToken(token);
    if (!student) throw new NotFoundException('стрічку не знайдено');

    const from = new Date(now.getTime() - 30 * 86_400_000);
    const to = new Date(now.getTime() + 180 * 86_400_000);
    const rows = await this.slots.forStudentCalendar(student.id, from, to);

    const events: CalendarEvent[] = rows.map((r) => ({
      slotId: r.id,
      startAt: new Date(r.start_at),
      endAt: new Date(r.end_at),
      summary: `Заняття: ${r.teacher_name}`,
      description: r.status === 'pre_booked' ? 'Не оплачене' : undefined,
      cancelled: r.status === 'cancelled_late',
    }));

    return buildCalendar(events, `Tutorflow — ${student.name}`, now);
  }

  /**
   * Бронювання. Балансу достатньо — слот одразу `booked` і гроші списані;
   * ні — `pre_booked` із дедлайном оплати. Відмовляти через брак коштів не
   * потрібно: місце закріплене, лишилось заплатити.
   *
   * Читання слота перед UPDATE потрібне ЛИШЕ для ціни й часу. Авторитетна
   * перевірка — умова `status = 'free'` усередині UPDATE: між читанням і
   * записом встигає пройти інший запрос.
   */
  async book(slotId: number, student: StudentContext, now = new Date()) {
    const slot = await this.slots.byId(slotId);
    if (!slot || slot.teacher_id !== student.teacherId) {
      throw new NotFoundException('слот не знайдено');
    }

    const rejection = bookRejection(
      { status: slot.status, startAt: new Date(slot.start_at) },
      now,
    );
    if (rejection === 'not_free') throw new ConflictException('слот уже зайнятий');
    if (rejection === 'in_the_past') throw new BadRequestException('заняття вже минуло');

    const teacher = await this.teachers.byId(slot.teacher_id);
    if (!teacher) throw new NotFoundException('викладача не знайдено');

    const result = await this.db.transaction().execute(async (tx) => {
      const affordable = await this.charge.isAffordable(tx, student.id, slot.price_minor);

      const claimed = affordable
        ? await this.slots.claimFree(slotId, student.id, { status: 'booked', paidAt: now }, tx)
        : await this.slots.claimFree(
            slotId, student.id,
            {
              status: 'pre_booked',
              holdExpiresAt: holdDeadline(new Date(slot.start_at), teacher.payment_deadline_hours),
            },
            tx,
          );

      // нуль змінених рядків означає, що слот щойно забрали
      if (!claimed) throw new ConflictException('слот щойно забрали');

      if (affordable) {
        await this.charge.chargeForLesson(tx, student.id, slotId, slot.price_minor);
      }

      return {
        id: claimed.id,
        status: claimed.status,
        paid: affordable,
        payBy: claimed.hold_expires_at ? new Date(claimed.hold_expires_at).toISOString() : null,
      };
    });

    // Слот захоплений і зафіксований. Якщо списання за нього відкладене в
    // журнал, зараз саме той момент, коли його треба віднести сусідові: у
    // моноліті рядок нічого не робить, бо кошти вже списані тією самою
    // транзакцією.
    await this.outbox.flush();

    return result;
  }

  /**
   * Скасування студентом. Для `pre_booked` — завжди безкоштовно, бо гроші не
   * списувались. Для `booked` діє правило `cancelHours` із межею включно.
   */
  async cancel(slotId: number, student: StudentContext, now = new Date()) {
    const slot = await this.slots.byId(slotId);
    if (!slot) throw new NotFoundException('слот не знайдено');
    if (slot.student_id !== student.id) {
      throw new ForbiddenException('це не ваше заняття');
    }

    const teacher = await this.teachers.byId(slot.teacher_id);
    if (!teacher) throw new NotFoundException('викладача не знайдено');

    let outcome: 'free' | 'cancelled_late';
    try {
      outcome = cancelOutcome(
        { status: slot.status, startAt: new Date(slot.start_at) },
        now,
        teacher.cancel_hours,
      );
    } catch (e) {
      if (e instanceof NothingToCancelError) throw new BadRequestException(e.message);
      throw e;
    }

    const wasPaid = slot.status === 'booked';

    const result = await this.db.transaction().execute(async (tx) => {
      const moved = await this.slots.transition(slotId, slot.status, outcome, tx);
      if (!moved) throw new ConflictException('стан слота щойно змінився');

      // повертаємо кошти лише якщо вони справді були списані
      if (outcome === 'free' && wasPaid) {
        await this.charge.refundForLesson(tx, student.id, slotId, slot.price_minor);
      }

      return { id: moved.id, status: moved.status, refunded: outcome === 'free' && wasPaid };
    });

    await this.outbox.flush();
    return result;
  }

  /**
   * Скасування ВИКЛАДАЧЕМ.
   *
   * Окремий метод, а не прапорець у `cancel`, бо правило інше: `cancelHours`
   * не застосовується, `cancelled_late` не виникає, а оплачене заняття завжди
   * повертає кошти. Один метод на дві ролі довелось би розгалужувати всередині
   * на кожному кроці — від перевірки прав до проводки.
   *
   * Повернення й звільнення слота — одна транзакція. Авторитетна перевірка тут
   * теж не в коді, а в умові `status = <прочитаний статус>` усередині UPDATE:
   * студент міг скасувати це саме заняття в ту саму мить, і тоді повернення
   * пішло б удруге.
   */
  async cancelByTeacher(slotId: number, teacherId: number, now = new Date()) {
    const slot = await this.slots.byId(slotId);
    if (!slot || slot.teacher_id !== teacherId) {
      throw new NotFoundException('слот не знайдено');
    }

    let outcome: TeacherCancelOutcome;
    try {
      outcome = teacherCancelOutcome(
        { status: slot.status, startAt: new Date(slot.start_at) },
        now,
      );
    } catch (e) {
      if (e instanceof NothingToCancelError || e instanceof LessonAlreadyStartedError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }

    // Обидва скасовувані статуси за інваріантом бази мають студента. Якщо його
    // немає — це поломка даних, і повертати кошти «нікому» не можна.
    const studentId = slot.student_id;
    if (studentId === null) {
      throw new ConflictException('у занятті немає студента — повертати нікому');
    }

    const result = await this.db.transaction().execute(async (tx) => {
      const moved = await this.slots.transition(slotId, slot.status, outcome.status, tx);
      if (!moved) throw new ConflictException('стан слота щойно змінився');

      if (outcome.refund) {
        await this.charge.refundForLesson(tx, studentId, slotId, slot.price_minor);
      }

      return {
        id: moved.id,
        status: moved.status,
        studentId,
        refunded: outcome.refund,
        refundedMinor: outcome.refund ? slot.price_minor : 0,
      };
    });

    await this.outbox.flush();

    // Скасування — єдина операція, про яку студент НЕ дізнається сам: заняття
    // просто зникає з його сітки. Подія публікується після коміту, бо описує
    // те, що вже сталось; якщо шина недоступна, скасування від цього не
    // скасовується — лише нагадування не піде.
    await this.events.publish({
      type: 'lesson.cancelled_by_teacher',
      slotId: result.id,
      studentId,
      startAt: new Date(slot.start_at).toISOString(),
      refundedMinor: result.refundedMinor,
    });

    return result;
  }

  async setAvailability(
    teacherId: number,
    rule: { weekday: number; startTime: string; durationMin: number; priceMinor: number },
  ) {
    return this.availability.upsertRule(teacherId, rule);
  }

  /**
   * Прибрати годину з тижневого шаблону.
   *
   * Дві дії в одній транзакції: правило вимикається, і майбутні ВІЛЬНІ слоти
   * цієї години зникають із сітки. Без другої половини година лишалась би в
   * продажу до кінця вже згенерованого горизонту — викладач прибрав би її з
   * шаблону й далі бачив у розкладі.
   *
   * Зайняті заняття не чіпаються свідомо: прибрати годину — це «більше її не
   * продавай», а не «скасуй тим, хто вже записався».
   */
  async removeAvailability(teacherId: number, ruleId: number) {
    return this.db.transaction().execute(async (tx) => {
      const rule = await this.availability.deactivateRule(ruleId, teacherId, tx);
      if (!rule) throw new NotFoundException('години не знайдено');

      const slotsRemoved = await this.slots.deleteFreeByRule(
        { teacherId, weekday: rule.weekday, startTime: rule.start_time },
        tx,
      );

      return { id: rule.id, slotsRemoved };
    });
  }

  listEnrollments(teacherId: number) {
    return this.availability.listEnrollments(teacherId);
  }

  listAvailability(teacherId: number) {
    return this.availability.listRules(teacherId);
  }

  /** Згенерувати слоти на N тижнів уперед. Ідемпотентно. */
  async generate(teacherId: number, weeks: number, now = new Date()) {
    const to = new Date(now.getTime() + weeks * 7 * 86_400_000);
    const created = await this.slots.generateFromRules(teacherId, now, to);
    return { created, from: now.toISOString(), to: to.toISOString() };
  }

  /**
   * Закріпити студента за годиною в розкладі. Майбутні вільні слоти на цю
   * годину одразу стають `pre_booked` — викладачеві не потрібно нічого
   * підтверджувати, студент і так ходить щотижня.
   */
  async enroll(
    teacherId: number,
    studentId: number,
    place: { weekday: number; startTime: string },
  ) {
    return this.db.transaction().execute(async (tx) => {
      const enrollment = await this.availability.createEnrollment(studentId, place, tx);
      const held = await this.slots.claimForEnrollment(
        {
          enrollmentId: enrollment.id,
          studentId,
          teacherId,
          weekday: place.weekday,
          startTime: place.startTime,
        },
        tx,
      );
      return { id: enrollment.id, slotsHeld: held };
    });
  }

  /** Зняти закріплення: майбутні неоплачені слоти звільняються. */
  async unenroll(teacherId: number, enrollmentId: number) {
    return this.db.transaction().execute(async (tx) => {
      const row = await this.availability.deactivateEnrollment(enrollmentId, teacherId, tx);
      if (!row) throw new NotFoundException('закріплення не знайдено');
      const released = await this.slots.releaseEnrollmentSlots(enrollmentId, tx);
      return { id: row.id, slotsReleased: released };
    });
  }

  /**
   * Закрити найближчі неоплачені заняття студента коштами, що є на балансі.
   *
   * Викликається після поповнення. Слоти беруться в хронологічному порядку, і
   * підрахунок спиняється на першому, якого не вистачило: оплатив чотири
   * заняття — закрились чотири найближчі.
   *
   * Операція живе тут, бо змінює стан слота. Скільки саме закривати, вирішує
   * правило з ядра на основі балансу, який віддає порт. У лабораторній 3 цей
   * виклик перетне межу сервісів і стане подією з outbox.
   */
  async applyPayment(tx: Executor, studentId: number, now = new Date()) {
    const pending = await this.slots.pendingPayment(studentId, tx);
    if (pending.length === 0) return [] as number[];

    const balance = await this.charge.balanceOf(tx, studentId);
    const covered = slotsCoveredBy(
      minor(balance),
      pending.map((p) => minor(p.price_minor)),
    );

    const converted: number[] = [];
    for (const slot of pending.slice(0, covered)) {
      const moved = await this.slots.convertToBooked(slot.id, now, tx);
      if (!moved) continue; // хтось випередив — просто пропускаємо
      await this.charge.chargeForLesson(tx, studentId, slot.id, slot.price_minor);
      converted.push(slot.id);
    }

    return converted;
  }

  /**
   * КОМПЕНСАЦІЯ невдалого списання.
   *
   * Викликається лише тоді, коли списання за заняття пішло в сусідній сервіс
   * окремим кроком і той відмовив назавжди — коштів на балансі не виявилось.
   * У моноліті цього методу не кликав би ніхто: там захоплення слота й
   * списання — одна транзакція, і «слот оплачений, а гроші не списані» не
   * існує як стан.
   *
   * Повертаємо заняття в `pre_booked` зі строком оплати, тобто в той самий
   * стан, у який воно стало б одразу, якби про брак коштів було відомо на
   * початку. Студент не втрачає місця — він лишається з обовʼязком заплатити.
   *
   * Ідемпотентно: умова на поточний стан стоїть у самому UPDATE, тому повтор
   * не зачепить заняття, яке за цей час уже скасували.
   */
  async revertFailedCharge(slotId: number): Promise<boolean> {
    const slot = await this.slots.byId(slotId);
    if (!slot || slot.status !== 'booked') return false;

    const teacher = await this.teachers.byId(slot.teacher_id);
    if (!teacher) throw new NotFoundException('викладача не знайдено');

    const moved = await this.slots.downgradeToPreBooked(
      slotId,
      holdDeadline(new Date(slot.start_at), teacher.payment_deadline_hours),
    );

    return moved !== null;
  }

  /** Фонові задачі. У лабораторній 1 викликаються вручну, у лабораторній 2 — воркером. */
  expireHolds(now = new Date()) { return this.slots.expireHolds(now); }
  completePast(now = new Date()) { return this.slots.completePast(now); }
}
