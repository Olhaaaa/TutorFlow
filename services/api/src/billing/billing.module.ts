import { Module, forwardRef } from '@nestjs/common';
import { CHARGE_PORT, STUDENT_DIRECTORY } from '../scheduling/ports.js';
import { LESSONS_PORT } from './ports.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { ChargeAdapter } from './charge.adapter.js';
import { StudentDirectoryAdapter } from './student-directory.adapter.js';
import { StudentsRepository } from './students.repository.js';
import { TransactionsRepository } from './transactions.repository.js';

/**
 * Модуль білінгу. Постачає реалізацію ChargePort, якої чекає розклад.
 *
 * forwardRef тут не випадковість: модулі справді залежать один від одного.
 * Розклад не може забронювати, не списавши кошти; білінг не може закрити
 * оплачені заняття, не змінивши стан слота. У моноліті це розвʼязується
 * спільною транзакцією й взаємним посиланням.
 *
 * У лабораторній 3 ця взаємність зникне: сервіси матимуть окремі бази,
 * спільної транзакції не буде, і замість прямого виклику зʼявиться подія з
 * outbox та компенсацією. Саме ця різниця — головний матеріал для порівняння
 * двох архітектур.
 */
@Module({
  imports: [forwardRef(() => SchedulingModule)],
  controllers: [BillingController],
  providers: [
    BillingService,
    StudentsRepository,
    TransactionsRepository,
    ChargeAdapter,
    { provide: CHARGE_PORT, useExisting: ChargeAdapter },
    StudentDirectoryAdapter,
    { provide: STUDENT_DIRECTORY, useExisting: StudentDirectoryAdapter },
  ],
  exports: [
    BillingService, CHARGE_PORT, STUDENT_DIRECTORY,
    StudentsRepository, TransactionsRepository,
  ],
})
export class BillingModule {}
