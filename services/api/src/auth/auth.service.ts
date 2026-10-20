import {
  BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable,
  Logger, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/bcrypt';
import {
  normalizeEmail, passwordIssues, THROTTLE, throttleDecision, TOKEN_TTL_MINUTES, tokenExpiry,
  type ThrottlePolicy, type TokenPurpose,
} from '@tutorflow/core';
import { config } from '../config.js';
import { MAIL_PORT, type MailPort } from '../mail/ports.js';
import { OUTBOX_FLUSH, type OutboxFlush } from '../outbox/flush.js';
import {
  passwordChangedMessage, resetPasswordMessage, verifyEmailMessage,
} from '../mail/templates.js';
import { AuthTokensRepository } from './auth-tokens.repository.js';
import { CREDENTIALS_PORT, type CredentialsPort } from './ports.js';
import { TokenService, type Role, type TokenPayload } from './token.service.js';

/**
 * Вартість bcrypt для нових паролів.
 *
 * Дванадцять, а не десять, як у сідера: сідер женеться за швидкістю заливки
 * демо-даних, а тут хеш рахується раз на реєстрацію. Старі хеші лишаються
 * чинними — bcrypt зберігає вартість у самому рядку.
 */
const BCRYPT_COST = 12;

export type { Role, TokenPayload } from './token.service.js';

@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');

  constructor(
    private readonly tokens: TokenService,
    @Inject(CREDENTIALS_PORT) private readonly credentials: CredentialsPort,
    private readonly oneTime: AuthTokensRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    @Inject(OUTBOX_FLUSH) private readonly outbox: OutboxFlush,
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
  async login(email: string, password: string, now = new Date()) {
    const address = normalizeEmail(email);
    await this.guardRate(`login:${address}`, THROTTLE.login, now);

    const found = await this.credentials.byEmail(address);
    if (!found || !(await verify(password, found.passwordHash))) {
      throw new UnauthorizedException('невірна пошта або пароль');
    }

    /* Перевірка пошти стоїть ПІСЛЯ пароля навмисно. Якби вона стояла до,
       форма входу відповідала б «підтвердіть пошту» на будь-яку відому
       адресу — тобто казала б стороннім, що акаунт існує. */
    if (!found.emailVerified) {
      throw new ForbiddenException(
        'пошта не підтверджена — перевірте скриньку або запросіть новий лист',
      );
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

  /* ──────────────────── реєстрація й підтвердження пошти ──────────────────── */

  /**
   * Реєстрація викладача.
   *
   * Відповідь ОДНАКОВА і для вільної пошти, і для зайнятої: інакше форма
   * реєстрації перетворюється на довідник «хто в нас є». Зайнята адреса
   * отримує лист про те, що на неї вже є акаунт, — так власник дізнається
   * про спробу, а сторонній не дізнається нічого.
   *
   * Акаунт створюється НЕПІДТВЕРДЖЕНИМ і до підтвердження не пускає у вхід.
   * Лист надсилається після створення; якщо пошта лягла, акаунт лишається —
   * лист можна запросити повторно, а втрачений акаунт довелось би чистити.
   */
  async register(
    input: { name: string; email: string; password: string; timezone: string; priceMinor?: number },
    now = new Date(),
  ) {
    const email = normalizeEmail(input.email);
    await this.guardRate(`register:${email}`, THROTTLE.register, now);
    this.assertPasswordUsable(input.password, email);

    if (!isValidTimeZone(input.timezone)) {
      throw new BadRequestException(`невідомий часовий пояс: ${input.timezone}`);
    }

    const created = await this.credentials.createTeacher({
      name: input.name.trim(),
      email,
      passwordHash: await hash(input.password, BCRYPT_COST),
      timezone: input.timezone,
      defaultPriceMinor: input.priceMinor ?? 50_000,
    });

    if (!created) {
      const existing = await this.credentials.byEmail(email);
      if (existing) {
        await this.sendSafely({
          to: email,
          subject: 'Спроба реєстрації — Tutorflow',
          text: [
            `Вітаємо, ${existing.name}!`,
            '',
            'Хтось намагався зареєструвати акаунт на цю адресу, але він уже існує.',
            'Якщо це були ви — просто увійдіть; пароль можна відновити через форму входу.',
          ].join('\n'),
        });
      }
      return { status: 'pending' as const };
    }

    /* Та сама межа двох архітектур, що й у бронюванні: у моноліті рядок
       нічого не робить, бо викладач уже видний усім; у мікросервісах він
       віддає профіль розкладу й білінгу, не чекаючи наступного проходу. */
    await this.outbox.flush();

    await this.sendVerification(created.id, created.name, created.email, now);
    return { status: 'pending' as const };
  }

  /**
   * Підтвердити пошту одноразовим кодом із листа.
   *
   * Код гаситься в тому ж запросі, яким перевіряється, тому повторне
   * відкриття листа віддає ту саму помилку, що й підробний код: «посилання
   * недійсне». Відрізняти ці випадки для користувача немає сенсу, а для
   * зловмисника — корисно.
   */
  async verifyEmail(token: string, now = new Date()) {
    const owner = await this.oneTime.consume('verify_email', token, now);
    if (!owner) throw new BadRequestException('посилання недійсне або вже використане');

    await this.credentials.markEmailVerified(owner.subjectId, now);
    const who = await this.credentials.identityById(owner.subjectId, owner.role);

    return { verified: true as const, email: who?.email ?? null };
  }

  /**
   * Надіслати лист підтвердження ще раз.
   *
   * Відповідь однакова завжди — і для невідомої адреси, і для вже
   * підтвердженої. Це той самий захист від перебору, що й на реєстрації.
   */
  async resendVerification(email: string, now = new Date()) {
    const address = normalizeEmail(email);
    await this.guardRate(`verify:${address}`, THROTTLE.send_email, now);

    const found = await this.credentials.byEmail(address);
    if (found && !found.emailVerified) {
      await this.sendVerification(found.id, found.name, found.email, now);
    }

    return { status: 'sent' as const };
  }

  /* ─────────────────────────── пароль ─────────────────────────── */

  /**
   * Запит на відновлення пароля.
   *
   * Завжди 200 і завжди та сама відповідь. Лист іде лише тому, хто справді
   * існує; решта не отримує нічого й не дізнається нічого.
   */
  async forgotPassword(email: string, now = new Date()) {
    const address = normalizeEmail(email);
    await this.guardRate(`reset:${address}`, THROTTLE.send_email, now);

    const found = await this.credentials.byEmail(address);
    if (found && found.emailVerified) {
      const token = await this.oneTime.issue({
        purpose: 'reset_password',
        role: found.role,
        subjectId: found.id,
        expiresAt: tokenExpiry('reset_password', now),
      });

      await this.sendSafely(resetPasswordMessage(
        found.email, found.name, this.link('reset', token), TOKEN_TTL_MINUTES.reset_password,
      ));
    }

    return { status: 'sent' as const };
  }

  /**
   * Задати новий пароль за кодом із листа.
   *
   * Після зміни гасяться ВСІ одноразові коди людини, а не лише використаний:
   * якщо доступ до скриньки був у сторонньої особи, її лист із кодом
   * відновлення має перестати працювати в ту ж мить.
   */
  async resetPassword(token: string, password: string, now = new Date()) {
    const owner = await this.oneTime.consume('reset_password', token, now);
    if (!owner) throw new BadRequestException('посилання недійсне або вже використане');

    const who = await this.credentials.identityById(owner.subjectId, owner.role);
    if (!who) throw new BadRequestException('посилання недійсне або вже використане');

    this.assertPasswordUsable(password, who.email);
    await this.credentials.setPassword(
      owner.subjectId, owner.role, await hash(password, BCRYPT_COST), now,
    );
    await this.oneTime.revokeAll(owner.role, owner.subjectId, now);
    await this.sendSafely(passwordChangedMessage(who.email, who.name, now));

    return { status: 'changed' as const };
  }

  /**
   * Зміна пароля тим, хто вже увійшов.
   *
   * Поточний пароль обовʼязковий навіть за чинного токена: токен міг
   * залишитись у чужих руках — на спільному компʼютері, у збереженій сесії, —
   * і без цієї перевірки він давав би змогу забрати акаунт назавжди.
   */
  async changePassword(
    user: { id: number; role: Role },
    current: string,
    next: string,
    now = new Date(),
  ) {
    const who = await this.credentials.identityById(user.id, user.role);
    if (!who) throw new NotFoundException('користувача не знайдено');

    const record = await this.credentials.byEmail(who.email);
    if (!record || !(await verify(current, record.passwordHash))) {
      throw new UnauthorizedException('поточний пароль невірний');
    }

    this.assertPasswordUsable(next, who.email);
    if (await verify(next, record.passwordHash)) {
      throw new BadRequestException('новий пароль збігається з поточним');
    }

    await this.credentials.setPassword(user.id, user.role, await hash(next, BCRYPT_COST), now);
    await this.oneTime.revokeAll(user.role, user.id, now);
    await this.sendSafely(passwordChangedMessage(who.email, who.name, now));

    return { status: 'changed' as const };
  }

  /* ─────────────────────────── службове ─────────────────────────── */

  private async sendVerification(id: number, name: string, email: string, now: Date) {
    const token = await this.oneTime.issue({
      purpose: 'verify_email',
      role: 'teacher',
      subjectId: id,
      expiresAt: tokenExpiry('verify_email', now),
    });

    await this.sendSafely(verifyEmailMessage(
      email, name, this.link('verify', token), TOKEN_TTL_MINUTES.verify_email / 60,
    ));
  }

  /**
   * Посилання з листа.
   *
   * Будується від `PUBLIC_BASE_URL`, бо лист читають поза застосунком і
   * відносна адреса в ньому безглузда. Якщо зовнішньої адреси немає —
   * локальний запуск, — у посилання йде шлях, і в лозі його видно повністю.
   */
  private link(route: 'verify' | 'reset', token: string): string {
    /* Хеш, а не шлях: SPA маршрутизується хешем, і такий лінк не вимагає,
       щоб сервер віддавав index.html на невідомій адресі. Той самий вигляд
       має й повернення з оплати — `#payment-<id>`. */
    const path = `/#${route}-${encodeURIComponent(token)}`;
    return config.publicBaseUrl ? new URL(path, config.publicBaseUrl).toString() : path;
  }

  /**
   * Надіслати лист, не ламаючи запрос.
   *
   * Поштовий шлюз — зовнішня система, і його відмова не повинна
   * перетворюватись на помилку реєстрації: акаунт уже створений, а лист
   * можна запросити повторно. Причина пишеться в лог; вміст листа — ні.
   */
  private async sendSafely(message: { to: string; subject: string; text: string; html?: string }) {
    try {
      await this.mail.send(message);
    } catch (e) {
      this.log.error(`лист «${message.subject}» не пішов: ${(e as Error).message}`);
    }
  }

  private assertPasswordUsable(password: string, email: string): void {
    const issues = passwordIssues(password);
    if (normalizeEmail(password) === normalizeEmail(email)) issues.push('looks_like_email');
    if (issues.length > 0) {
      throw new BadRequestException({
        message: 'пароль не годиться',
        issues: [...new Set(issues)],
        minLength: 12,
      });
    }
  }

  /**
   * Обмеження частоти.
   *
   * Рішення ухвалює ядро, база лише зберігає лічильник. Відмова — 429 із
   * `Retry-After`: клієнт має знати, коли пробувати знову, інакше він
   * повторює запрос негайно й тримає лічильник на межі вічно.
   */
  private async guardRate(key: string, policy: ThrottlePolicy, now: Date): Promise<void> {
    const state = await this.oneTime.throttleState(key);
    const decision = throttleDecision(state, policy, now);
    await this.oneTime.bump(key, decision.next);

    if (!decision.allowed) {
      throw new HttpException(
        { message: 'забагато спроб — спробуйте пізніше', retryAfterSeconds: decision.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
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
