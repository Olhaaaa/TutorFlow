import { Module } from '@nestjs/common';
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
  imports: [DatabaseModule, SchedulingModule],
  controllers: [HealthController],
})
export class AppModule {}
