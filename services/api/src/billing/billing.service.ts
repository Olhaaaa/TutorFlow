import {
  BadRequestException, Inject, Injectable, NotFoundException, forwardRef,
} from '@nestjs/common';
import { balanceFrom, minor, shortfall } from '@tutorflow/core';
import { KYSELY, type Database, type Executor } from '../db/database.module.js';
import { SchedulingService } from '../scheduling/scheduling.service.js';
import { SlotsRepository } from '../scheduling/slots.repository.js';
import { StudentsRepository } from './students.repository.js';
import { type HistoryDirection, TransactionsRepository } from './transactions.repository.js';

/**
 * Драйвер pg віддає timestamptz як Date, але Kysely описує колонку через
 * ColumnType, і при вибірці окремих полів тип не звужується. Один помічник
 * замість приведення в кожному місці.
 */
const iso = (v: unknown): string => new Date(v as string | number | Date).toISOString();

/** Рядок журналу у вигляді, придатному для клієнта. Один на всі відповіді з історією. */
const toHistoryItem = (t: {
  id: number; amount_minor: number; kind: string;
  slot_id: number | null; comment: string | null; created_at: unknown;
}) => ({
  id: t.id,
  amountMinor: t.amount_minor,
  kind: t.kind,
  slotId: t.slot_id,
  comment: t.comment,
  at: iso(t.created_at),
});

@Injectable()
export class BillingService {
  constructor(
    @Inject(KYSELY) private readonly db: Database,
    private readonly students: StudentsRepository,
    private readonly transactions: TransactionsRepository,
    private readonly slots: SlotsRepository,
    @Inject(forwardRef(() => SchedulingService))
    private readonly scheduling: SchedulingService,
  ) {}

  /** Баланс, історія операцій і скільки лишилось доплатити за закріплені заняття. */
  async balance(studentId: number) {
    const student = await this.students.byId(studentId);
    if (!student) throw new NotFoundException('студента не знайдено');

    const [history, pending] = await Promise.all([
      this.transactions.recent(studentId),
      this.slots.pendingPayment(studentId),
    ]);

    return {
      balanceMinor: student.balance_minor,
      dueMinor: shortfall(
        minor(student.balance_minor),
        pending.map((p) => minor(p.price_minor)),
      ),
      unpaid: pending.map((p) => ({
        slotId: p.id,
        startAt: iso(p.start_at),
        priceMinor: p.price_minor,
      })),
      history: history.map(toHistoryItem),
    };
  }

  /**
   * Історія операцій окремо від балансу — щоб фільтр напрямку доходив до
   * запросу.
   *
   * Чому не параметром до `/balance`: баланс тягнеться на кожному відкритті
   * кабінету, а перемикач напрямку чіпає лише один список на картці. Змішати
   * їх означало б перечитувати борг і неоплачені заняття щоразу, коли студент
   * натиснув «поповнення».
   */
  async history(studentId: number, direction: HistoryDirection = 'all') {
    const rows = await this.transactions.recent(studentId, { direction });
    return rows.map(toHistoryItem);
  }

  listStudents(teacherId: number) {
    return this.students.listByTeacher(teacherId);
  }

  createStudent(
    teacherId: number,
    s: { name: string; email: string; passwordHash: string; timezone: string },
  ) {
    return this.students.create(teacherId, s);
  }

  /**
   * Поповнення балансу викладачем.
   *
   * Одразу після зарахування коштів закриваються найближчі неоплачені
   * заняття — саме цього очікує студент, який заплатив «за чотири уроки».
   * Усе в одній транзакції: або гроші зараховані й слоти закриті, або нічого.
   */
  async topup(teacherId: number, studentId: number, amountMinor: number, comment?: string) {
    if (amountMinor <= 0) throw new BadRequestException('сума поповнення має бути додатною');

    const student = await this.students.byId(studentId);
    if (!student || student.teacher_id !== teacherId) {
      throw new NotFoundException('студента не знайдено');
    }

    return this.db.transaction().execute(async (tx) => this.credit(tx, studentId, amountMinor, comment));
  }

  /**
   * Зарахування коштів усередині ЧУЖОЇ транзакції.
   *
   * Винесено з topup заради платежів: там зарахування мусить статись у тій
   * самій транзакції, що й позначка платежу як проведеного. Якби це були дві
   * транзакції, повторний вебхук провайдера міг би зарахувати гроші вдруге —
   * між ними є проміжок, у який платіж уже оплачений, але ще не позначений.
   */
  async credit(tx: Executor, studentId: number, amountMinor: number, comment?: string | null) {
    const transaction = await this.transactions.add(
      { studentId, amountMinor, kind: 'topup', comment: comment ?? null }, tx,
    );
    await this.students.shiftBalance(studentId, amountMinor, tx);
    const converted = await this.scheduling.applyPayment(tx, studentId);

    // Баланс перечитується ПІСЛЯ конвертації: applyPayment списує кошти за
    // закриті заняття, тому значення, отримане від shiftBalance, застаріває
    // в ту ж мить. Віддати його назовні означало б показати користувачу
    // суму, якої на рахунку вже немає.
    const after = await this.students.byId(studentId, tx);

    return {
      transactionId: transaction.id,
      balanceMinor: after?.balance_minor ?? 0,
      convertedSlots: converted,
    };
  }

  /**
   * Звірка кешованого балансу із сумою транзакцій.
   * Якщо вони розійшлись — у коді є помилка, і краще дізнатись про неї тут.
   *
   * Викладач передається обовʼязково, як у topup: ідентифікатор студента
   * приходить зі шляху, тому без перевірки власності маршрут віддавав би
   * баланс будь-якого студента системи кожному, хто перебирає числа.
   * Чужий студент — 404, а не 403: наявність чужого рядка теж не наше діло.
   */
  async audit(teacherId: number, studentId: number) {
    const [student, sum] = await Promise.all([
      this.students.byId(studentId),
      this.transactions.sum(studentId),
    ]);
    if (!student || student.teacher_id !== teacherId) {
      throw new NotFoundException('студента не знайдено');
    }

    const fromJournal = balanceFrom([{ amountMinor: minor(sum) }]);
    return {
      cached: student.balance_minor,
      fromJournal,
      consistent: student.balance_minor === fromJournal,
    };
  }
}
