import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { MoneyTransfer, TransferResult } from '@tutorflow/contracts';
import { chargeAmount, isAffordable, minor, refundAmount } from '@tutorflow/core';
import { KYSELY, type Database } from '../db/database.module.js';
import { StudentsRepository } from './students.repository.js';
import { TransactionsRepository } from './transactions.repository.js';

/** Коштів не вистачає. Окремий клас, бо відповідь на це — компенсація, не повтор. */
export class InsufficientFundsError extends Error {
  constructor(readonly studentId: number, readonly amountMinor: number) {
    super('коштів на балансі не вистачає');
    this.name = 'InsufficientFundsError';
  }
}

/** Порушення унікального індексу в PostgreSQL. */
const UNIQUE_VIOLATION = '23505';

/**
 * Рух коштів, який прийшов ІЗВНІ — від сусіднього сервіса, а не з власного
 * запросу.
 *
 * Чому це окремий сервіс, а не метод ChargeAdapter. Адаптер виконує списання
 * всередині ЧУЖОЇ транзакції — тієї самої, що змінює слот, — і саме тому
 * ключа ідемпотентності не потребує: повторитись така операція не може, бо
 * транзакція або була, або ні. Тут транзакції немає: є запрос по мережі, який
 * міг прийти вдруге, і власна транзакція, яку треба відкрити самому.
 *
 * У моноліті цей клас не викликає ніхто — і це не мертвий код, а рівно та
 * різниця, яку лабораторна 3 й міряє: ціна відсутності спільної транзакції.
 */
@Injectable()
export class TransfersService {
  private readonly log = new Logger('Transfers');

  constructor(
    @Inject(KYSELY) private readonly db: Database,
    private readonly students: StudentsRepository,
    private readonly transactions: TransactionsRepository,
  ) {}

  /**
   * Застосувати списання або повернення РІВНО РАЗ.
   *
   * Повтор розпізнається за `opId` і не є помилкою: сусід мав право не
   * отримати нашого підтвердження й надіслати те саме завдання знову.
   * Відповідь на повтор така сама, як на першу спробу, лише `applied: false`.
   *
   * Для списання перевіряється баланс. Відмова тут — НЕ збій: між перевіркою
   * доступності на боці розкладу й цим запросом баланс могла зрушити
   * паралельна операція. Відповіддю на відмову є компенсація в розкладі
   * (заняття повертається в `pre_booked`), а не повтор, тому помилка окремого
   * типу.
   */
  async apply(
    kind: 'lesson_charge' | 'refund',
    t: MoneyTransfer,
  ): Promise<TransferResult> {
    try {
      return await this.db.transaction().execute(async (tx) => {
        const already = await this.transactions.byOpId(t.opId, tx);
        if (already) {
          const current = await this.students.byId(t.studentId, tx);
          return { applied: false, balanceMinor: current?.balance_minor ?? 0 };
        }

        const student = await this.students.byId(t.studentId, tx);
        if (!student) throw new NotFoundException('студента не знайдено');

        if (kind === 'lesson_charge'
          && !isAffordable(minor(student.balance_minor), minor(t.amountMinor))) {
          throw new InsufficientFundsError(t.studentId, t.amountMinor);
        }

        const amount = kind === 'lesson_charge'
          ? chargeAmount(minor(t.amountMinor))
          : refundAmount(minor(t.amountMinor));

        await this.transactions.add(
          {
            studentId: t.studentId,
            amountMinor: amount,
            kind,
            slotId: t.slotId,
            opId: t.opId,
          },
          tx,
        );
        const after = await this.students.shiftBalance(t.studentId, amount, tx);

        return { applied: true, balanceMinor: after?.balance_minor ?? 0 };
      });
    } catch (e) {
      // Два завдання з тим самим ключем приїхали одночасно: перевірка вище
      // пропустила обидва, а індекс — лише одне. Друге отримує ту саму
      // відповідь, що й будь-який інший повтор.
      if (isUniqueViolation(e)) {
        this.log.log(`операція ${t.opId}: повтор, застосована раніше`);
        const current = await this.students.byId(t.studentId);
        return { applied: false, balanceMinor: current?.balance_minor ?? 0 };
      }
      throw e;
    }
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e
    && (e as { code?: unknown }).code === UNIQUE_VIOLATION;
}
