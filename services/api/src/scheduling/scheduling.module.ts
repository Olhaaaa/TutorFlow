import { Module, forwardRef } from '@nestjs/common';
import { AvailabilityRepository } from './availability.repository.js';
import { BillingModule } from '../billing/billing.module.js';
import { SchedulingController } from './scheduling.controller.js';
import { SchedulingService } from './scheduling.service.js';
import { SlotsRepository } from './slots.repository.js';
import { TeachersRepository } from './teachers.repository.js';

/**
 * Модуль розкладу. У лабораторній 3 стає окремим сервісом,
 * тому назовні він знає тільки про ChargePort, а не про білінг напряму.
 *
 * Реалізацію CHARGE_PORT постачає модуль білінгу. Розклад знає лише про
 * інтерфейс і не імпортує нічого з його нутрощів.
 */
@Module({
  imports: [forwardRef(() => BillingModule)],
  controllers: [SchedulingController],
  providers: [
    SchedulingService,
    SlotsRepository,
    TeachersRepository,
    AvailabilityRepository,
  ],
  exports: [SchedulingService, SlotsRepository, TeachersRepository],
})
export class SchedulingModule {}
