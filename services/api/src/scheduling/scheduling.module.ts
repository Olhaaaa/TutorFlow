import { Module, forwardRef } from '@nestjs/common';
import { LESSONS_PORT } from '../billing/ports.js';
import { AvailabilityRepository } from './availability.repository.js';
import { ExternalBusyRepository } from './external-busy.repository.js';
import { BillingModule } from '../billing/billing.module.js';
import { RemindersService } from './reminders.service.js';
import { CalendarController } from './calendar.controller.js';
import { SchedulingController } from './scheduling.controller.js';
import { LessonsAdapter } from './lessons.adapter.js';
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
  controllers: [SchedulingController, CalendarController],
  providers: [
    SchedulingService,
    RemindersService,
    SlotsRepository,
    TeachersRepository,
    AvailabilityRepository,
    ExternalBusyRepository,
    LessonsAdapter,
    { provide: LESSONS_PORT, useExisting: LessonsAdapter },
  ],
  exports: [
    SchedulingService, RemindersService, LESSONS_PORT,
    SlotsRepository, TeachersRepository,
  ],
})
export class SchedulingModule {}
