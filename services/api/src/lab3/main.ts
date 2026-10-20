import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { OutboxDrain } from '../outbox/outbox.drain.js';
import { OutboxRegistry } from '../outbox/outbox.registry.js';
import { BillingOutbox } from './billing.outbox.js';
import { bootHttp, serviceRole } from './bootstrap.js';
import { lab3 } from './config.js';
import { IdentityOutbox } from './identity.outbox.js';
import { SchedulingOutbox } from './scheduling.outbox.js';
import {
  BillingServiceModule, GatewayServiceModule, IdentityServiceModule,
  NotificationsServiceModule, SchedulingServiceModule,
} from './services.js';

/**
 * Точка входу ВСІХ пʼяти сервісів лабораторної 3.
 *
 *   node dist/lab3/main.js scheduling
 *
 * Один образ і пʼять команд — той самий прийом, що й у лабораторній 2, де
 * воркер відрізнявся від API лише командою. Інакше порівняння архітектур
 * перестало б бути порівнянням архітектур: різниця знайшлася б у збірках.
 *
 * Реєстрація обробників outbox стоїть саме тут, а не в модулі, і це видно
 * свідомо: у цьому рядку написано, що САМЕ цей сервіс доставляє сусідам.
 * Заразом розривається коло залежностей — обробник кличе доменний сервіс, а
 * той залежить від дренажу журналу.
 */
async function bootstrap(): Promise<void> {
  const role = serviceRole();
  const log = new Logger('Lab3');

  switch (role) {
    case 'gateway':
      await bootHttp(GatewayServiceModule, 'Єдиний вхід: маршрутизація за префіксом і SPA');
      break;

    case 'identity': {
      const app = await bootHttp(
        IdentityServiceModule,
        'Вхід: реєстрація, пароль, токен, часовий пояс',
      );
      // Реєстрація народжує викладача саме тут — і звідси ж його профіль
      // їде до розкладу й білінгу журналом відкладених доставок.
      app.get(OutboxRegistry).register(app.get(IdentityOutbox).handlers());

      /* Воркера у входу немає — і не додаємо: заради однієї черги на
         реєстрацію окремий контейнер не вартий. Натомість дренаж крутиться
         в самому процесі. Негайну доставку робить flush після реєстрації,
         а цей прохід — друга лінія: він добирає те, що не пішло з першого
         разу, бо сусід у ту мить був недоступний. */
      void app.get(OutboxDrain).run(() => false, lab3.outboxIntervalMs);
      break;
    }

    case 'scheduling': {
      const app = await bootHttp(
        SchedulingServiceModule,
        'Розклад: доступність, бронювання, перенесення, стрічки .ics',
      );
      app.get(OutboxRegistry).register(app.get(SchedulingOutbox).handlers());
      break;
    }

    case 'billing': {
      const app = await bootHttp(
        BillingServiceModule,
        'Гроші: баланс, журнал проводок, оплата карткою',
      );
      app.get(OutboxRegistry).register(app.get(BillingOutbox).handlers());
      break;
    }

    case 'notifications':
      await bootHttp(
        NotificationsServiceModule,
        'Нагадування: журнал, канал доставки, привʼязка чату',
      );
      break;
  }

  log.log(`сервіс ${role} піднятий`);
}

void bootstrap();
