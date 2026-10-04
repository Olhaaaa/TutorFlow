import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { DatabaseModule } from './db/database.module.js';
import { HealthController } from './health/health.controller.js';
import { SchedulingModule } from './scheduling/scheduling.module.js';

/**
 * Модулі збігаються з межами доменів. У лабораторній 3 кожен стає сервісом:
 *   SchedulingModule    — розклад і бронювання
 *   BillingModule       — баланс і списання
 *   NotificationsModule — нагадування, з лабораторної 2
 */
@Module({
  imports: [
    DatabaseModule,
    SchedulingModule,
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
