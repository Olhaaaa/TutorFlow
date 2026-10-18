import { Module, forwardRef } from '@nestjs/common';
import { CHARGE_PORT, STUDENT_DIRECTORY } from '../scheduling/ports.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { ChargeAdapter } from './charge.adapter.js';
import { StudentDirectoryAdapter } from './student-directory.adapter.js';
import { StudentsRepository } from './students.repository.js';
import { TransactionsRepository } from './transactions.repository.js';
import { TransfersService } from './transfers.service.js';

/**
 * Усе, із чого складається білінг. Перелік один на дві архітектури.
 *
 * Тут і реалізації ДВОХ портів, які оголосив розклад: ChargePort (рух коштів у
 * спільній транзакції) і StudentDirectoryPort (імена студентів і токен
 * стрічки). У моноліті вони потрібні сусідній вертикалі, у сервісі білінгу —
 * нікому, але шкоди не роблять: це просто два тонкі адаптери над власними
 * репозиторіями.
 */
const PROVIDERS = [
  BillingService,
  TransfersService,
  StudentsRepository,
  TransactionsRepository,
  ChargeAdapter,
  { provide: CHARGE_PORT, useExisting: ChargeAdapter },
  StudentDirectoryAdapter,
  { provide: STUDENT_DIRECTORY, useExisting: StudentDirectoryAdapter },
];

const EXPORTS = [
  BillingService, TransfersService, CHARGE_PORT, STUDENT_DIRECTORY,
  StudentsRepository, TransactionsRepository,
];

/**
 * Модуль білінгу в МОНОЛІТІ.
 *
 * `forwardRef` на розклад — не випадковість: у моноліті білінг реалізує порти
 * розкладу, а розклад реалізує порт білінгу (LessonsPort), і ця взаємність
 * тримається на спільній транзакції. Саме вона зникає в лабораторній 3: бази
 * стають окремими, і замість взаємного виклику зʼявляється запис у outbox із
 * компенсацією. Ця різниця — головний матеріал для порівняння двох архітектур.
 */
@Module({
  imports: [forwardRef(() => SchedulingModule)],
  controllers: [BillingController],
  providers: PROVIDERS,
  exports: EXPORTS,
})
export class BillingModule {}

/**
 * Той самий білінг без сусідньої вертикалі в графі — для сервіса лабораторної 3.
 * Реалізацію LessonsPort постачає композиція: запросом по HTTP до розкладу.
 */
@Module({
  controllers: [BillingController],
  providers: PROVIDERS,
  exports: EXPORTS,
})
export class BillingCoreModule {}
