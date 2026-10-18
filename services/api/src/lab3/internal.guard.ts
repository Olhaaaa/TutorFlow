import { CanActivate, Injectable, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { INTERNAL_TOKEN_HEADER } from '@tutorflow/contracts';
import { lab3 } from './config.js';

/**
 * Внутрішні маршрути — не для світу.
 *
 * Перший рубіж — розгортання: порти сервісів назовні не публікуються, і з
 * інтернету до `/internal` дістатись неможливо, бо gateway проксіює лише
 * `/api`. Цей guard — другий рубіж, на випадок, коли перший зняли: хтось
 * опублікував порт, щоб подивитись логи, і забув.
 *
 * Перевіряється спільний секрет, а не токен користувача, бо питання тут інше:
 * не «хто ця людина», а «чи це взагалі наш сервіс». Без заданого секрету
 * маршрути відкриті — так зручно дивитись їх curl-ом локально, і саме тому в
 * compose секрет задається.
 */
@Injectable()
export class InternalGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!lab3.internalToken) return true;

    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const raw = req.headers[INTERNAL_TOKEN_HEADER];
    const presented = Array.isArray(raw) ? raw[0] : raw;

    if (presented !== lab3.internalToken) {
      throw new UnauthorizedException('внутрішній маршрут: потрібен службовий заголовок');
    }
    return true;
  }
}
