import { Injectable, Logger } from '@nestjs/common';
import type { MoneyTransfer, OutboxOutcome, TransferResult } from '@tutorflow/contracts';
import type { OutboxHandler, OutboxHandlers } from '../outbox/outbox.drain.js';
import { SchedulingService } from '../scheduling/scheduling.service.js';
import { InternalClient, PeerRejectedError } from './internal.client.js';

/**
 * Хто і як доносить до білінгу те, що лишила транзакція розкладу.
 *
 * Два завдання — списання й повернення, — і реагують вони на відмову
 * ПО-РІЗНОМУ. Це не симетрія, яку забули дотримати, а різна ціна помилки.
 *
 * Списання: сусід має право відмовити («коштів не вистачає»), і ця відмова
 * остаточна. Повторювати немає сенсу, тому замість повтору — компенсація:
 * заняття повертається в `pre_booked`. Студент лишається з місцем і з
 * обовʼязком заплатити, тобто ровно там, де був би, якби балансу не вистачало
 * з самого початку.
 *
 * Повернення: відмовити по суті тут неможливо — ми повертаємо СВОЇ ж списані
 * кошти. Тому будь-яка невдача трактується як «спробуємо ще», і завдання
 * лишається в журналі. Закрити його як «відмовлено» означало б тихо забрати
 * гроші студента, а цього не робить жодна відмова сусіда.
 */
@Injectable()
export class SchedulingOutbox {
  private readonly log = new Logger('SchedulingOutbox');

  constructor(
    private readonly internal: InternalClient,
    private readonly scheduling: SchedulingService,
  ) {}

  handlers(): OutboxHandlers {
    return {
      'billing.charge': this.charge(),
      'billing.refund': this.refund(),
    };
  }

  private charge(): OutboxHandler {
    return {
      deliver: async (payload): Promise<OutboxOutcome> => {
        const transfer = payload as MoneyTransfer;
        try {
          const res = await this.internal.post<TransferResult>(
            'billing', '/internal/transfers/charge', transfer,
          );
          if (!res.applied) {
            this.log.log(`операція ${transfer.opId}: білінг уже застосував її раніше`);
          }
          return 'done';
        } catch (e) {
          if (e instanceof PeerRejectedError) {
            this.log.warn(
              `списання за заняття ${transfer.slotId} відмовлено`
              + `${e.insufficientFunds ? ' (не вистачає коштів)' : ''}: ${e.message}`,
            );
            return 'compensate';
          }
          throw e;
        }
      },

      compensate: async (payload): Promise<void> => {
        const transfer = payload as MoneyTransfer;
        const reverted = await this.scheduling.revertFailedCharge(transfer.slotId);
        this.log.log(
          reverted
            ? `заняття ${transfer.slotId} повернуто в неоплачене`
            : `заняття ${transfer.slotId} компенсувати не довелось: стан уже інший`,
        );
      },
    };
  }

  private refund(): OutboxHandler {
    return {
      deliver: async (payload): Promise<OutboxOutcome> => {
        const transfer = payload as MoneyTransfer;
        const res = await this.internal.post<TransferResult>(
          'billing', '/internal/transfers/refund', transfer,
        );
        if (!res.applied) {
          this.log.log(`повернення ${transfer.opId}: білінг уже застосував його раніше`);
        }
        return 'done';
      },
    };
  }
}
