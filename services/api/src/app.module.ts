import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { DatabaseModule } from './db/database.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthController } from './health/health.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { BillingModule } from './billing/billing.module.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { NoopOutboxModule } from './outbox/outbox.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { SchedulingModule } from './scheduling/scheduling.module.js';
import { TelegramModule } from './telegram/telegram.module.js';

/**
 * Модулі збігаються з межами доменів. У лабораторній 3 кожен стає сервісом:
 *   SchedulingModule    — розклад і бронювання
 *   BillingModule       — баланс і списання
 *   NotificationsModule — нагадування, з лабораторної 2
 */
@Module({
  imports: [
    DatabaseModule,
    EventsModule,
    // Моноліт нічого не відкладає: межі між сервісами тут немає, і `flush()`
    // після коміту лишається порожнім викликом.
    NoopOutboxModule,
    SchedulingModule,
    BillingModule,
    PaymentsModule,
    MaintenanceModule,
    NotificationsModule,
    TelegramModule,
    AuthModule,
    // Збірка фронтенду віддається тим самим процесом: одна одиниця
    // розгортання й жодних питань із CORS. exclude обовʼязковий — без нього
    // статика перехопить усі запроси й API перестане відповідати.
    ServeStaticModule.forRoot({
      rootPath: join(import.meta.dirname, '..', 'static'),
      exclude: ['/api/{*path}'],
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
