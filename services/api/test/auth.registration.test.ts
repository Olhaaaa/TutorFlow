/**
 * Реєстрація, підтвердження пошти, відновлення й зміна пароля.
 *
 * Тест інтеграційний, бо половина правил живе саме в базі: унікальність
 * пошти, одноразовість коду й лічильник спроб, спільний для всіх процесів.
 * Перевіряти їх підробками означало б перевіряти підробки.
 *
 * Пошта тут підроблена навмисно — це єдина зовнішня система в потоці, і
 * збирати листи в масив дешевше, ніж піднімати SMTP. Усе інше справжнє.
 *
 * Потрібна піднята локальна база: docker compose -f compose.dev.yml up -d
 */
import { JwtService } from '@nestjs/jwt';
import { hash } from '@node-rs/bcrypt';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { AuthTokensRepository } from '../src/auth/auth-tokens.repository.js';
import { LocalCredentialsAdapter } from '../src/auth/credentials.adapter.js';
import { TokenService } from '../src/auth/token.service.js';
import { StudentsRepository } from '../src/billing/students.repository.js';
import { createDatabase } from '../src/db/database.module.js';
import type { MailMessage, MailPort } from '../src/mail/ports.js';
import { NoopOutboxFlush } from '../src/outbox/flush.js';
import { TeachersRepository } from '../src/scheduling/teachers.repository.js';

const db = createDatabase();
const teachers = new TeachersRepository(db);
const students = new StudentsRepository(db);
const oneTime = new AuthTokensRepository(db);
const tokens = new TokenService(new JwtService({ secret: 'test', signOptions: { expiresIn: '7d' } }));

/** Поштова скринька, яку видно з тесту. Єдина підробка в цьому файлі. */
class Mailbox implements MailPort {
  readonly configured = true;
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> { this.sent.push(message); }
  get last(): MailMessage | undefined { return this.sent[this.sent.length - 1]; }
  clear(): void { this.sent.length = 0; }
}

const mailbox = new Mailbox();
const auth = new AuthService(
  tokens,
  new LocalCredentialsAdapter(teachers, students),
  oneTime,
  mailbox,
  new NoopOutboxFlush(),
);

const NOW = new Date('2026-10-20T10:00:00Z');
const PASSWORD = 'кава з молоком о сьомій';
const NEXT_PASSWORD = 'інша довга фраза 2026';

/** Код із листа: він у посиланні, і дістається звідти так само, як людиною. */
function tokenFrom(message: MailMessage | undefined): string {
  const found = /#(?:verify|reset)-([A-Za-z0-9_%-]+)/.exec(message?.text ?? '');
  if (!found) throw new Error('у листі немає посилання з кодом');
  return decodeURIComponent(found[1]!);
}

async function reset(): Promise<void> {
  await db.deleteFrom('auth_tokens').execute();
  await db.deleteFrom('auth_throttle').execute();
  await db.deleteFrom('external_busy').execute();
  await db.deleteFrom('notifications').execute();
  await db.deleteFrom('payments').execute();
  await db.deleteFrom('transactions').execute();
  await db.deleteFrom('slots').execute();
  await db.deleteFrom('availability_rules').execute();
  await db.deleteFrom('students').execute();
  await db.deleteFrom('teachers').execute();
  mailbox.clear();
}

const register = (email = 'maria@example.com', password = PASSWORD, now = NOW) =>
  auth.register({ name: 'Марія Коваль', email, password, timezone: 'Europe/Kyiv' }, now);

beforeEach(reset);
afterAll(async () => { await db.destroy(); });

describe('реєстрація', () => {
  it('створює викладача непідтвердженим і надсилає лист із кодом', async () => {
    const res = await register();

    expect(res).toEqual({ status: 'pending' });
    const row = await teachers.byEmailWithSecret('maria@example.com');
    expect(row?.email_verified_at).toBeNull();
    expect(mailbox.last?.subject).toContain('Підтвердіть пошту');
    expect(tokenFrom(mailbox.last).length).toBeGreaterThan(20);
  });

  it('пошта зберігається в канонічному вигляді', async () => {
    await register('  Maria@EXAMPLE.com  ');
    expect(await teachers.byEmailWithSecret('maria@example.com')).not.toBeNull();
  });

  it('до підтвердження вхід не пускає — навіть із правильним паролем', async () => {
    await register();
    await expect(auth.login('maria@example.com', PASSWORD, NOW)).rejects.toThrow(/не підтверджена/);
  });

  it('після підтвердження вхід працює, а код згорає', async () => {
    await register();
    const code = tokenFrom(mailbox.last);

    expect(await auth.verifyEmail(code, NOW)).toEqual({ verified: true, email: 'maria@example.com' });

    const session = await auth.login('maria@example.com', PASSWORD, NOW);
    expect(session.role).toBe('teacher');
    await expect(auth.verifyEmail(code, NOW)).rejects.toThrow(/недійсне/);
  });

  it('зайнята пошта не створює другого акаунта й не зізнається в цьому', async () => {
    await register();
    mailbox.clear();

    const second = await register('maria@example.com', 'ще одна довга фраза');

    expect(second).toEqual({ status: 'pending' });
    const all = await db.selectFrom('teachers').select('id').execute();
    expect(all).toHaveLength(1);
    // Власник адреси дізнається про спробу — сторонній не дізнається нічого.
    expect(mailbox.last?.subject).toContain('Спроба реєстрації');
  });

  it('слабкий пароль відхиляється з переліком причин', async () => {
    await expect(register('short@example.com', 'коротко')).rejects.toMatchObject({
      response: { issues: ['too_short'] },
    });
  });

  it('повторне надсилання листа гасить попередній код', async () => {
    await register();
    const first = tokenFrom(mailbox.last);

    await auth.resendVerification('maria@example.com', new Date(NOW.getTime() + 60_000));
    const second = tokenFrom(mailbox.last);

    expect(second).not.toBe(first);
    await expect(auth.verifyEmail(first, NOW)).rejects.toThrow(/недійсне/);
    expect(await auth.verifyEmail(second, NOW)).toMatchObject({ verified: true });
  });

  it('прострочений код не працює', async () => {
    await register();
    const code = tokenFrom(mailbox.last);
    const tomorrow = new Date(NOW.getTime() + 25 * 3_600_000);

    await expect(auth.verifyEmail(code, tomorrow)).rejects.toThrow(/недійсне/);
  });
});

describe('відновлення пароля', () => {
  async function verifiedTeacher(): Promise<void> {
    await register();
    await auth.verifyEmail(tokenFrom(mailbox.last), NOW);
    mailbox.clear();
  }

  it('невідома адреса дає ту саму відповідь і жодного листа', async () => {
    expect(await auth.forgotPassword('ніхто@example.com', NOW)).toEqual({ status: 'sent' });
    expect(mailbox.sent).toHaveLength(0);
  });

  it('код із листа змінює пароль, і старий перестає працювати', async () => {
    await verifiedTeacher();
    await auth.forgotPassword('maria@example.com', NOW);

    await auth.resetPassword(tokenFrom(mailbox.last), NEXT_PASSWORD, NOW);

    await expect(auth.login('maria@example.com', PASSWORD, NOW)).rejects.toThrow();
    const session = await auth.login('maria@example.com', NEXT_PASSWORD, NOW);
    expect(session.id).toBeGreaterThan(0);
  });

  it('після зміни надсилається сповіщення власникові', async () => {
    await verifiedTeacher();
    await auth.forgotPassword('maria@example.com', NOW);
    await auth.resetPassword(tokenFrom(mailbox.last), NEXT_PASSWORD, NOW);

    expect(mailbox.last?.subject).toContain('Пароль змінено');
  });

  it('код відновлення одноразовий', async () => {
    await verifiedTeacher();
    await auth.forgotPassword('maria@example.com', NOW);
    const code = tokenFrom(mailbox.last);

    await auth.resetPassword(code, NEXT_PASSWORD, NOW);
    await expect(auth.resetPassword(code, 'третя довга фраза', NOW)).rejects.toThrow(/недійсне/);
  });

  it('непідтверджена пошта відновлення не отримує', async () => {
    await register();
    mailbox.clear();

    await auth.forgotPassword('maria@example.com', NOW);
    expect(mailbox.sent).toHaveLength(0);
  });
});

describe('зміна пароля у кабінеті', () => {
  let teacherId: number;

  beforeEach(async () => {
    await register();
    await auth.verifyEmail(tokenFrom(mailbox.last), NOW);
    const row = await teachers.byEmailWithSecret('maria@example.com');
    teacherId = row!.id;
    mailbox.clear();
  });

  it('вимагає поточний пароль навіть за чинного токена', async () => {
    await expect(
      auth.changePassword({ id: teacherId, role: 'teacher' }, 'не той', NEXT_PASSWORD, NOW),
    ).rejects.toThrow(/поточний пароль/);
  });

  it('міняє пароль і повідомляє про це листом', async () => {
    await auth.changePassword({ id: teacherId, role: 'teacher' }, PASSWORD, NEXT_PASSWORD, NOW);

    await expect(auth.login('maria@example.com', PASSWORD, NOW)).rejects.toThrow();
    expect((await auth.login('maria@example.com', NEXT_PASSWORD, NOW)).id).toBe(teacherId);
    expect(mailbox.last?.subject).toContain('Пароль змінено');
  });

  it('новий пароль, що збігається з поточним, відхиляється', async () => {
    await expect(
      auth.changePassword({ id: teacherId, role: 'teacher' }, PASSWORD, PASSWORD, NOW),
    ).rejects.toThrow(/збігається/);
  });

  it('гасить чинні коди відновлення: чужий лист перестає працювати', async () => {
    await auth.forgotPassword('maria@example.com', NOW);
    const stolen = tokenFrom(mailbox.last);

    await auth.changePassword({ id: teacherId, role: 'teacher' }, PASSWORD, NEXT_PASSWORD, NOW);

    await expect(auth.resetPassword(stolen, 'третя довга фраза', NOW)).rejects.toThrow(/недійсне/);
  });

  it('працює і для студента, якого завів викладач', async () => {
    const student = await students.create(teacherId, {
      name: 'Віра', email: 'vira@example.com',
      passwordHash: await hash(PASSWORD, 10), timezone: 'Europe/Kyiv',
    });

    await auth.changePassword({ id: student.id, role: 'student' }, PASSWORD, NEXT_PASSWORD, NOW);
    expect((await auth.login('vira@example.com', NEXT_PASSWORD, NOW)).role).toBe('student');
  });
});

describe('обмеження частоти', () => {
  it('четверта реєстрація на ту саму адресу відхиляється', async () => {
    for (let i = 0; i < 3; i++) {
      await register('spam@example.com', PASSWORD, new Date(NOW.getTime() + i * 1000));
    }

    await expect(
      register('spam@example.com', PASSWORD, new Date(NOW.getTime() + 4000)),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('лічильник спільний для процесів: він у базі, а не в памʼяті', async () => {
    await register('shared@example.com');
    const row = await db
      .selectFrom('auth_throttle').select(['key', 'attempts'])
      .where('key', '=', 'register:shared@example.com')
      .executeTakeFirst();

    expect(row?.attempts).toBe(1);
  });

  it('після вікна лічильник обнуляється', async () => {
    for (let i = 0; i < 3; i++) await register('later@example.com');
    const afterWindow = new Date(NOW.getTime() + 61 * 60_000);

    // Четверта спроба вже в новому вікні — проходить
    await expect(register('later@example.com', PASSWORD, afterWindow)).resolves.toEqual({
      status: 'pending',
    });
  });
});
