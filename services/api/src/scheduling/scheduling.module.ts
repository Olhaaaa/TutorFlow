import { Module } from '@nestjs/common';
import { AvailabilityRepository } from './availability.repository.js';
import { CHARGE_PORT, UnavailableChargeAdapter } from './ports.js';
import { SchedulingController } from './scheduling.controller.js';
import { SchedulingService } from './scheduling.service.js';
import { SlotsRepository } from './slots.repository.js';
import { TeachersRepository } from './teachers.repository.js';

/**
 * Модуль розкладу. У лабораторній 3 стає окремим сервісом,
 * тому назовні він знає тільки про ChargePort, а не про білінг напряму.
 *
 * CHARGE_PORT поки постачається заглушкою. Коли зʼявиться
 * BillingModule, тут лишиться прибрати UnavailableChargeAdapter — більше
 * нічого в цьому модулі не зміниться.
 */
@Module({
  controllers: [SchedulingController],
  providers: [
    SchedulingService,
    SlotsRepository,
    TeachersRepository,
    AvailabilityRepository,
    { provide: CHARGE_PORT, useClass: UnavailableChargeAdapter },
  ],
  exports: [SchedulingService, SlotsRepository],
})
export class SchedulingModule {}
