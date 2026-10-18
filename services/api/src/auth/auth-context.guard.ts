import { CanActivate, Injectable, type ExecutionContext } from '@nestjs/common';
import { TokenService } from './token.service.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';

/**
 * Заповнює запрос даними з токена й НЕ відхиляє запроси без нього.
 *
 * Залежить від перевірки ТОКЕНА, а не від сервіса входу: підпис звіряється
 * секретом, і бази для цього не потрібно. Через це той самий guard стоїть у
 * кожному сервісі лабораторної 3, жоден з яких не має реквізитів входу.
 *
 * Рішення про те, чи потрібна автентифікація, ухвалює обробник через
 * декоратори CurrentStudent і CurrentTeacher: вони кидають 401, якщо потрібного
 * користувача немає. Так відкриті маршрути — вхід і перевірка живості —
 * працюють без окремих винятків у конфігурації.
 */
@Injectable()
export class AuthContextGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers['authorization'];
    const raw = Array.isArray(header) ? header[0] : header;

    if (raw?.startsWith('Bearer ')) {
      const payload = this.tokens.verify(raw.slice(7));
      if (payload?.role === 'teacher') {
        req.teacher = { id: payload.sub };
      } else if (payload?.role === 'student') {
        req.student = { id: payload.sub, teacherId: payload.teacherId };
      }
    }

    return true;
  }
}
