import { CanActivate, Injectable, type ExecutionContext } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';

/**
 * Заповнює запрос даними з токена й НЕ відхиляє запроси без нього.
 *
 * Рішення про те, чи потрібна автентифікація, ухвалює обробник через
 * декоратори CurrentStudent і CurrentTeacher: вони кидають 401, якщо потрібного
 * користувача немає. Так відкриті маршрути — вхід і перевірка живості —
 * працюють без окремих винятків у конфігурації.
 */
@Injectable()
export class AuthContextGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers['authorization'];
    const raw = Array.isArray(header) ? header[0] : header;

    if (raw?.startsWith('Bearer ')) {
      const payload = this.auth.verifyToken(raw.slice(7));
      if (payload?.role === 'teacher') {
        req.teacher = { id: payload.sub };
      } else if (payload?.role === 'student') {
        req.student = { id: payload.sub, teacherId: payload.teacherId };
      }
    }

    return true;
  }
}
