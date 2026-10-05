import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceService } from './maintenance.service.js';

/**
 * Переходи станів за часом. У лабораторній 2 весь модуль переїде у воркер —
 * він уже зараз нічого не знає ні про HTTP-запрос, ні про користувача.
 */
@Module({
  imports: [SchedulingModule, PaymentsModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
