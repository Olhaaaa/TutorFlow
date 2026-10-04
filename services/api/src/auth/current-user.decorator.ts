import {
  createParamDecorator, UnauthorizedException, type ExecutionContext,
} from '@nestjs/common';
import type { StudentContext } from '../scheduling/scheduling.service.js';

/**
 * МЕЖА З МОДУЛЕМ АВТЕНТИФІКАЦІЇ. Він реалізується окремо, тому тут лише контракт:
 * guard автентифікації мусить покласти в запрос `student` або `teacher`.
 *
 * Поки guard не зʼявився, у не-продакшн оточенні працює підміна через
 * заголовки — щоб розклад можна було перевіряти без чекання. У продакшні
 * підміна вимкнена й запрос отримує 401.
 */
export interface AuthenticatedRequest {
  student?: StudentContext;
  teacher?: { id: number };
  headers: Record<string, string | string[] | undefined>;
}

function devHeader(req: AuthenticatedRequest, name: string): number | null {
  if (process.env.NODE_ENV === 'production') return null;
  const raw = req.headers[name];
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const CurrentStudent = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): StudentContext => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (req.student) return req.student;

    const id = devHeader(req, 'x-student-id');
    const teacherId = devHeader(req, 'x-teacher-id');
    if (id !== null && teacherId !== null) return { id, teacherId };

    throw new UnauthorizedException(
      'потрібна автентифікація студента — очікується guard автентифікації',
    );
  },
);

export const CurrentTeacher = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): { id: number } => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (req.teacher) return req.teacher;

    const id = devHeader(req, 'x-teacher-id');
    if (id !== null) return { id };

    throw new UnauthorizedException(
      'потрібна автентифікація викладача — очікується guard автентифікації',
    );
  },
);
