import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verify } from '@node-rs/bcrypt';
import { StudentsRepository } from '../billing/students.repository.js';
import { TeachersRepository } from '../scheduling/teachers.repository.js';

export type Role = 'student' | 'teacher';

/** Те, що лежить у токені. Нічого зайвого: лише те, чим авторизуються запроси. */
export interface TokenPayload {
  sub: number;
  role: Role;
  /** Для студента — його викладач; для викладача — він сам. */
  teacherId: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly students: StudentsRepository,
    private readonly teachers: TeachersRepository,
  ) {}

  /**
   * Вхід за поштою й паролем.
   *
   * Спершу шукаємо серед викладачів, потім серед студентів. Відповідь на
   * невдачу однакова в обох випадках і не каже, чи існує така пошта — інакше
   * форму входу можна було б використати для перебору адрес.
   */
  async login(email: string, password: string) {
    const teacher = await this.teachers.byEmailWithSecret(email);
    if (teacher && (await verify(password, teacher.password_hash))) {
      return this.issue(
        { sub: teacher.id, role: 'teacher', teacherId: teacher.id },
        teacher.name,
        teacher.timezone,
      );
    }

    const student = await this.students.byEmailWithSecret(email);
    if (student && (await verify(password, student.password_hash))) {
      return this.issue(
        { sub: student.id, role: 'student', teacherId: student.teacher_id },
        student.name,
        student.timezone,
      );
    }

    throw new UnauthorizedException('невірна пошта або пароль');
  }

  /**
   * Часовий пояс віддається разом із токеном, а не окремим запросом: клієнт
   * малює розклад У ЧАСІ СТУДЕНТА, тому без зони він не може показати навіть
   * перший екран. У токен зона не кладеться — вона змінна, а токен живе тиждень.
   */
  private issue(payload: TokenPayload, name: string, timezone: string) {
    return {
      token: this.jwt.sign(payload),
      role: payload.role,
      id: payload.sub,
      name,
      timezone,
    };
  }

  /**
   * Зміна власного часового поясу.
   *
   * Один метод на обидві ролі: і студент, і викладач однаково дивляться
   * розклад у своєму часі, і однаково можуть переїхати. Різниця лише в тому,
   * яку таблицю правити.
   *
   * Назва зони перевіряється через Intl, а не списком у коді: база IANA
   * оновлюється з новими правилами переходу на літній час, і зашитий перелік
   * застарів би мовчки.
   */
  async updateTimezone(user: { id: number; role: Role }, timezone: string) {
    if (!isValidTimeZone(timezone)) {
      throw new BadRequestException(`невідомий часовий пояс: ${timezone}`);
    }

    const updated = user.role === 'teacher'
      ? await this.teachers.updateTimezone(user.id, timezone)
      : await this.students.updateTimezone(user.id, timezone);

    if (!updated) throw new NotFoundException('користувача не знайдено');

    return { id: updated.id, role: user.role, name: updated.name, timezone: updated.timezone };
  }

  verifyToken(token: string): TokenPayload | null {
    try {
      return this.jwt.verify<TokenPayload>(token);
    } catch {
      return null;
    }
  }
}

/** Чи знає середовище таку зону. Єдина чесна перевірка назви з бази IANA. */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
