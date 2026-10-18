import { Module } from '@nestjs/common';
import { BillingCoreModule, BillingModule } from '../billing/billing.module.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { TeachersRepository } from '../scheduling/teachers.repository.js';
import { MonobankClient } from './monobank.client.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsRepository } from './payments.repository.js';
import { PaymentsService } from './payments.service.js';
import { TokenCipher } from './token-cipher.js';

/**
 * Платежі через зовнішнього провайдера.
 *
 * Модуль залежить від білінгу односторонньо: він лише просить зарахувати
 * кошти, а що далі станеться зі слотами — не його справа. Саме тому тут немає
 * forwardRef, на відміну від пари «розклад — білінг».
 *
 * У лабораторній 3 цей модуль переїде в сервіс billing разом із BillingService,
 * і виклик credit() стане внутрішнім, а не міжсервісним.
 */
@Module({
  imports: [BillingModule, SchedulingModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsRepository, MonobankClient, TokenCipher],
  exports: [PaymentsService, PaymentsRepository],
})
export class PaymentsModule {}

/**
 * Платежі в сервісі БІЛІНГУ.
 *
 * Еквайринг — це гроші, тому колонки `teachers.payment_*` належать білінгу, і
 * власний рядок викладача він тримає у себе: шифрований токен мерчанта не
 * їздить по мережі взагалі, навіть між нашими сервісами. Репозиторій
 * викладачів тому постачається локально — та сама таблиця, тільки від неї
 * лишились три колонки еквайрингу.
 *
 * Модуля розкладу тут немає: платежам від нього нічого не потрібно — вони лише
 * просять зарахувати кошти, а що станеться зі слотами, вирішує білінг через
 * свій порт.
 */
@Module({
  imports: [BillingCoreModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService, PaymentsRepository, MonobankClient, TokenCipher,
    TeachersRepository,
  ],
  exports: [PaymentsService, PaymentsRepository],
})
export class PaymentsCoreModule {}
