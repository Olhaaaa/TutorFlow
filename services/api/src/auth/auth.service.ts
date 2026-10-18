import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { verify } from '@node-rs/bcrypt';
import { CREDENTIALS_PORT, type CredentialsPort } from './ports.js';
import { TokenService, type Role, type TokenPayload } from './token.service.js';

export type { Role, TokenPayload } from './token.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly tokens: TokenService,
    @Inject(CREDENTIALS_PORT) private readonly credentials: CredentialsPort,
  ) {}

  /**
   * Вхід за поштою й паролем.
   *
   * Відповідь на невдачу однакова і для невідомої пошти, і для невірного
   * пароля, і не каже, чи існує така адреса: інакше форму входу можна було б
   * використати для перебору.
   *
   * Яку саме базу читає пошук реквізитів, сервіс не знає — це межа порту. У
   * моноліті це дві таблиці двох вертикалей, у лабораторній 3 — власна база
   * сервіса входу.
   */
  async login(email: string, password: string) {
    const found = await this.credentials.byEmail(email);
    if (!found || !(await verify(password, found.passwordHash))) {
      throw new UnauthorizedException('невірна пошта або пароль');
    }

    return this.issue(
      { sub: found.id, role: found.role, teacherId: found.teacherId },
      found.name,
      found.timezone,
    );
  }

  /**
   * Часовий пояс віддається разом із токеном, а не окремим запросом: клієнт
   * малює розклад У ЧАСІ СТУДЕНТА, тому без зони він не може показати навіть
   * перший екран. У токен зона не кладеться — вона змінна, а токен живе тиждень.
   */
  private issue(payload: TokenPayload, name: string, timezone: string) {
    return {
      token: this.tokens.sign(payload),
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
   * яку таблицю правити, і вона схована за портом.
   *
   * Назва зони перевіряється через Intl, а не списком у коді: база IANA
   * оновлюється з новими правилами переходу на літній час, і зашитий перелік
   * застарів би мовчки.
   */
  async updateTimezone(user: { id: number; role: Role }, timezone: string) {
    if (!isValidTimeZone(timezone)) {
      throw new BadRequestException(`невідомий часовий пояс: ${timezone}`);
    }

    const updated = await this.credentials.updateTimezone(user.id, user.role, timezone);
    if (!updated) throw new NotFoundException('користувача не знайдено');

    return { id: updated.id, role: user.role, name: updated.name, timezone: updated.timezone };
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
