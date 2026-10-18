import { Module, forwardRef } from '@nestjs/common';
import { LESSONS_PORT } from '../billing/ports.js';
import { BillingModule } from '../billing/billing.module.js';
import { AvailabilityRepository } from './availability.repository.js';
import { CalendarController } from './calendar.controller.js';
import { ExternalBusyRepository } from './external-busy.repository.js';
import { LessonsAdapter } from './lessons.adapter.js';
import { RemindersService } from './reminders.service.js';
import { SchedulingController } from './scheduling.controller.js';
import { SchedulingService } from './scheduling.service.js';
import { SlotsRepository } from './slots.repository.js';
import { TeachersRepository } from './teachers.repository.js';

/**
 * Усе, із чого складається розклад. Один перелік на дві архітектури: моноліт і
 * сервіс лабораторної 3 збирають ТІ САМІ провайдери й ті самі контролери, і
 * розходяться лише тим, звідки беруться межі.
 */
const CONTROLLERS = [SchedulingController, CalendarController];

const PROVIDERS = [
  SchedulingService,
  RemindersService,
  SlotsRepository,
  TeachersRepository,
  AvailabilityRepository,
  ExternalBusyRepository,
  LessonsAdapter,
  { provide: LESSONS_PORT, useExisting: LessonsAdapter },
];

const EXPORTS = [
  SchedulingService, RemindersService, LESSONS_PORT,
  SlotsRepository, TeachersRepository,
];

/**
 * Модуль розкладу в МОНОЛІТІ.
 *
 * Назовні він знає тільки про свої порти — ChargePort і StudentDirectoryPort, —
 * а не про білінг напряму. Але реалізації цих портів у моноліті постачає саме
 * модуль білінгу, тому він тут в імпортах: взаємність між вертикалями реальна,
 * і `forwardRef` її не ховає, а визнає. Розклад не може забронювати, не
 * списавши кошти; білінг не може закрити оплачені заняття, не змінивши стан
 * слота.
 */
@Module({
  imports: [forwardRef(() => BillingModule)],
  controllers: CONTROLLERS,
  providers: PROVIDERS,
  exports: EXPORTS,
})
export class SchedulingModule {}

/**
 * Той самий розклад, але БЕЗ сусідньої вертикалі в графі — для сервіса
 * лабораторної 3.
 *
 * Різниця рівно одна: модуля білінгу тут немає взагалі, тому в процесі не
 * зʼявляються ні його контролери, ні його репозиторії, ні його таблиці.
 * Реалізації портів постачає композиція сервіса — глобальним модулем, бо
 * сусід у процесі один на всіх, і описувати його в кожному модулі окремо
 * нічого не додає.
 */
@Module({
  controllers: CONTROLLERS,
  providers: PROVIDERS,
  exports: EXPORTS,
})
export class SchedulingCoreModule {}
