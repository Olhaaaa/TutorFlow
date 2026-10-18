import { Module, forwardRef } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LocalCredentialsAdapter } from './credentials.adapter.js';
import { CREDENTIALS_PORT } from './ports.js';
import { TokenModule } from './token.module.js';

/**
 * Вхід: маршрути, перевірка пароля й випуск токена.
 *
 * Реквізити беруться через CREDENTIALS_PORT, а не з таблиць напряму. У
 * моноліті порт реалізує адаптер, який читає `teachers` і `students` — єдине
 * місце застосунку, що зазирає в дані обох вертикалей. Саме через це вхід у
 * лабораторній 3 стає окремим сервісом із власною базою реквізитів.
 *
 * Перевірка токена живе в TokenModule й потрібна кожному сервісу; цей модуль
 * потрібен лише тому, хто токени ВИПИСУЄ.
 */
@Module({
  imports: [
    TokenModule,
    forwardRef(() => BillingModule),
    forwardRef(() => SchedulingModule),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalCredentialsAdapter,
    { provide: CREDENTIALS_PORT, useExisting: LocalCredentialsAdapter },
  ],
  exports: [AuthService],
})
export class AuthModule {}
