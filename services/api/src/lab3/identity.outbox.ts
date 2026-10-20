import { Injectable, Logger } from '@nestjs/common';
import type { TeacherProfile } from '@tutorflow/contracts';
import type { OutboxOutcome } from '@tutorflow/contracts';
import type { OutboxHandler, OutboxHandlers } from '../outbox/outbox.drain.js';
import { InternalClient } from './internal.client.js';

/**
 * Доставка того, що народжується у ВХОДІ.
 *
 * Досі сервіс входу лише приймав: реквізити студента йшли до нього з білінгу.
 * З появою форми реєстрації зʼявився зворотний напрям — викладач уперше
 * виникає тут, і про нього мають дізнатись розклад і білінг.
 *
 * Нагадуванням не надсилаємо нічого: у їхній базі таблиці викладачів немає
 * взагалі, і це не недогляд, а межа — нагадування адресуються студентові.
 *
 * Два завдання, а не одне на обох: доставка в розклад і доставка в білінг
 * падають незалежно. Якби вони були одним завданням, повторна спроба після
 * збою в білінгу заново била б у розклад, де все вже гаразд.
 */
@Injectable()
export class IdentityOutbox {
  private readonly log = new Logger('IdentityOutbox');

  constructor(private readonly internal: InternalClient) {}

  handlers(): OutboxHandlers {
    return {
      'scheduling.teacher': this.toPeer('scheduling'),
      'billing.teacher': this.toPeer('billing'),
    };
  }

  /**
   * Передати профіль сусідові.
   *
   * Приймач ідемпотентний — `on conflict do update`, — тому повторна
   * доставка безпечна, і завдання можна спокійно повторювати до успіху.
   * Компенсації тут немає свідомо: нічого скасовувати, акаунт уже існує, а
   * профіль у сусіда рано чи пізно зʼявиться.
   */
  private toPeer(service: 'scheduling' | 'billing'): OutboxHandler {
    return {
      deliver: async (payload: unknown): Promise<OutboxOutcome> => {
        const profile = payload as TeacherProfile;
        await this.internal.post(service, '/internal/teachers', profile);
        this.log.log(`профіль викладача ${profile.id} переданий сервісу ${service}`);
        return 'done';
      },
    };
  }
}
