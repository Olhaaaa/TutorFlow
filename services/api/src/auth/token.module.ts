import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { config } from '../config.js';
import { AuthContextGuard } from './auth-context.guard.js';
import { TokenService } from './token.service.js';

/**
 * Перевірка токена — усе, що потрібно сервісу, щоб знати, хто його кличе.
 *
 * Модуль глобальний і не має жодної залежності від бази, тому його імпортує
 * КОЖЕН сервіс: і моноліт, і розклад, і білінг, і нагадування. Виписує токени
 * лише той, у кого є реквізити входу, — у моноліті це той самий процес, у
 * лабораторній 3 окремий сервіс.
 *
 * Guard реєструється тут же й нікого не відхиляє: він лише заповнює запрос
 * даними з токена. Вимогу авторизації висловлюють обробники через декоратори,
 * тому відкриті маршрути — вхід, стрічка `.ics`, перевірка живості — не
 * потребують винятків у конфігурації.
 */
@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: config.jwtSecret,
      signOptions: { expiresIn: '7d' },
    }),
  ],
  providers: [TokenService, { provide: APP_GUARD, useClass: AuthContextGuard }],
  exports: [TokenService],
})
export class TokenModule {}
