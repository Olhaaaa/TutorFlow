import { Injectable, Logger } from '@nestjs/common';
import type {
  ApplyPaymentResult, CredentialUpsert, OutboxOutcome, StudentContact,
} from '@tutorflow/contracts';
import type { OutboxHandler, OutboxHandlers } from '../outbox/outbox.drain.js';
import { InternalClient, PeerRejectedError } from './internal.client.js';

/**
 * Що білінг доносить сусідам.
 *
 * Три завдання, і жодне з них не має компенсації — на відміну від списання в
 * розкладі. Причина в напрямку: білінг просить сусіда ЗАСТОСУВАТИ наслідок
 * уже зафіксованого факту (кошти зараховані, студент створений), а не
 * виконати частину спільної операції. Відмовити по суті тут нічого: якщо
 * сусід каже 4xx, повтор нічого не змінить, а відкочувати зарахування коштів
 * через те, що розклад не закрив заняття, було б гірше за будь-яку
 * неузгодженість.
 */
@Injectable()
export class BillingOutbox {
  private readonly log = new Logger('BillingOutbox');

  constructor(private readonly internal: InternalClient) {}

  handlers(): OutboxHandlers {
    return {
      'scheduling.apply_payment': this.applyPayment(),
      'identity.credential': this.credential(),
      'notifications.contact': this.contact(),
    };
  }

  private applyPayment(): OutboxHandler {
    return {
      deliver: async (payload): Promise<OutboxOutcome> => {
        const { studentId } = payload as { studentId: number };
        try {
          const res = await this.internal.post<ApplyPaymentResult>(
            'scheduling', `/internal/students/${studentId}/apply-payment`,
          );
          if (res.convertedSlots.length > 0) {
            this.log.log(
              `студенту ${studentId} закрито занять: ${res.convertedSlots.length}`,
            );
          }
          return 'done';
        } catch (e) {
          if (e instanceof PeerRejectedError) {
            // Розклад відмовив по суті — закривати нічого. Кошти лишаються
            // зарахованими, і це правильно: студент їх заплатив.
            this.log.warn(`закриття занять студента ${studentId} відхилено: ${e.message}`);
            return 'done';
          }
          throw e;
        }
      },
    };
  }

  private credential(): OutboxHandler {
    return {
      deliver: async (payload): Promise<OutboxOutcome> => {
        const rec = payload as CredentialUpsert;
        await this.internal.post('identity', '/internal/credentials', rec);
        this.log.log(`реквізити студента ${rec.id} передані сервісу входу`);
        return 'done';
      },
    };
  }

  private contact(): OutboxHandler {
    return {
      deliver: async (payload): Promise<OutboxOutcome> => {
        const contact = payload as StudentContact;
        await this.internal.post('notifications', '/internal/contacts', contact);
        this.log.log(`контакт студента ${contact.studentId} переданий каналу`);
        return 'done';
      },
    };
  }
}
