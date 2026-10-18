import { Module } from '@nestjs/common';
import { PaymentsExpiryAdapter } from '../payments/expiry.adapter.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { SchedulingCoreModule, SchedulingModule } from '../scheduling/scheduling.module.js';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceService } from './maintenance.service.js';
import { MaintenanceTimer } from './maintenance.timer.js';
import { PAYMENTS_EXPIRY } from './ports.js';

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
  providers: [
    MaintenanceService,
    MaintenanceTimer,
    PaymentsExpiryAdapter,
    { provide: PAYMENTS_EXPIRY, useExisting: PaymentsExpiryAdapter },
  ],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}

/**
 * Прохід переходів у сервісі РОЗКЛАДУ.
 *
 * Дві з трьох робіт проходу — його власні: звільнити прострочені закріплення й
 * закрити проведені заняття. Третя, протермінування рахунків, належить
 * білінгу, і в цій композиції її виконує запрос до сусіда — реалізацію
 * PAYMENTS_EXPIRY постачає композиція сервіса. Модуля платежів тут немає.
 */
@Module({
  imports: [SchedulingCoreModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService, MaintenanceTimer],
  exports: [MaintenanceService],
})
export class MaintenanceCoreModule {}
