import {
  BadRequestException, ConflictException, Inject, Injectable,
  NotFoundException, ForbiddenException,
} from '@nestjs/common';
import {
  bookRejection, cancelOutcome, holdDeadline, LessonAlreadyStartedError, minor,
  NothingToCancelError, slotsCoveredBy, teacherCancelOutcome,
  type TeacherCancelOutcome,
} from '@tutorflow/core';
import { KYSELY, type Database } from '../db/database.module.js';
import { EventBus } from '../events/event-bus.js';
import { AvailabilityRepository } from './availability.repository.js';
import { CHARGE_PORT, type ChargePort } from './ports.js';
import { SlotsRepository, type Executor } from './slots.repository.js';
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
  ) {}

  /** Розклад очима викладача: сирий статус і хто записаний. */
  async teacherCalendar(teacherId: number, from: Date, to: Date): Promise<TeacherSlotView[]> {
    const rows = await this.slots.inRangeWithStudents(teacherId, from, to);
    return rows.map((r) => ({
      id: r.id,
      startAt: new Date(r.start_at).toISOString(),
      endAt: new Date(r.end_at).toISOString(),
      priceMinor: r.price_minor,
      status: r.status,
      student: r.student_id === null ? null : { id: r.student_id, name: r.student_name ?? '—' },
      payBy: r.hold_expires_at ? new Date(r.hold_expires_at).toISOString() : null,
    }));
  }

  async calendar(
    teacherId: number,
    from: Date,
    to: Date,
    viewerStudentId: number | null,
  ): Promise<SlotView[]> {
    const rows = await this.slots.inRange(teacherId, from, to);
    return rows.map((r) => ({
      id: r.id,
      startAt: new Date(r.start_at).toISOString(),
      endAt: new Date(r.end_at).toISOString(),
      priceMinor: r.price_minor,
      state: toViewState(r.status, r.student_id, viewerStudentId),
      payBy:
        r.student_id === viewerStudentId && r.hold_expires_at
          ? new Date(r.hold_expires_at).toISOString()
          : null,
    }));
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

    return this.db.transaction().execute(async (tx) => {
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

    return this.db.transaction().execute(async (tx) => {
      const moved = await this.slots.transition(slotId, slot.status, outcome, tx);
      if (!moved) throw new ConflictException('стан слота щойно змінився');

      // повертаємо кошти лише якщо вони справді були списані
      if (outcome === 'free' && wasPaid) {
        await this.charge.refundForLesson(tx, student.id, slotId, slot.price_minor);
      }

      return { id: moved.id, status: moved.status, refunded: outcome === 'free' && wasPaid };
    });
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

  /** Фонові задачі. У лабораторній 1 викликаються вручну, у лабораторній 2 — воркером. */
  expireHolds(now = new Date()) { return this.slots.expireHolds(now); }
  completePast(now = new Date()) { return this.slots.completePast(now); }
}
