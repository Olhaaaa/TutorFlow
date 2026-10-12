import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceService } from './maintenance.service.js';
import { MaintenanceTimer } from './maintenance.timer.js';

/**
 * Переходи станів за часом. Модуль не знає ні про HTTP-запрос, ні про
 * користувача, тому однаково працює і в API, і у воркері.
 *
 * Хто саме запускає прохід — питання розгортання, а не модуля: у лабораторній
 * 2 це воркер, у розгортанні з одним процесом — таймер усередині API за
 * прапорцем MAINTENANCE_IN_API.
 */
@Module({
  imports: [SchedulingModule, PaymentsModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService, MaintenanceTimer],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
