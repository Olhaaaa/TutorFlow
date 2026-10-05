import {
  createParamDecorator, UnauthorizedException, type ExecutionContext,
} from '@nestjs/common';
import type { StudentContext } from '../scheduling/scheduling.service.js';

/**
 * Контракт автентифікації: guard кладе в запрос `student` або `teacher`,
 * обробники читають їх через ці декоратори.
 *
 * Додатково, у НЕ-продакшн оточенні працює підміна через заголовки — зручно
 * для ручних перевірок і для curl без входу. У продакшні вона вимкнена
 * перевіркою NODE_ENV, тому випадково туди не поїде.
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

/** Хто зараз у запросі, незалежно від ролі. Для /me. */
export interface CurrentUserInfo {
  id: number;
  role: 'student' | 'teacher';
  teacherId: number;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserInfo | null => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (req.teacher) return { id: req.teacher.id, role: 'teacher', teacherId: req.teacher.id };
    if (req.student) return { id: req.student.id, role: 'student', teacherId: req.student.teacherId };
    return null;
  },
);
