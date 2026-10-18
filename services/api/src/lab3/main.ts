import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { OutboxRegistry } from '../outbox/outbox.registry.js';
import { BillingOutbox } from './billing.outbox.js';
import { bootHttp, serviceRole } from './bootstrap.js';
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

    case 'identity':
      await bootHttp(IdentityServiceModule, 'Вхід: пароль, токен, часовий пояс');
      break;

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
