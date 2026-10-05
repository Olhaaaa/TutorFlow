import { Module, forwardRef } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { BillingModule } from '../billing/billing.module.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { config } from '../config.js';
import { AuthContextGuard } from './auth-context.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

/**
 * Автентифікація. Guard реєструється глобально, але нікого не відхиляє —
 * лише заповнює запрос даними з токена. Вимогу авторизації висловлюють самі
 * обробники через декоратори, тому відкриті маршрути не потребують винятків.
 */
@Module({
  imports: [
    JwtModule.register({
      secret: config.jwtSecret,
      signOptions: { expiresIn: '7d' },
    }),
    forwardRef(() => BillingModule),
    forwardRef(() => SchedulingModule),
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthContextGuard }],
  exports: [AuthService],
})
export class AuthModule {}
