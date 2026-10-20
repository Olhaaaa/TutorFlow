import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { LocalCredentialsAdapter } from '../auth/credentials.adapter.js';
import type { CredentialsPort, IdentityRecord, TeacherRegistration } from '../auth/ports.js';
import { KYSELY, type Database } from '../db/database.module.js';
import { OutboxRepository } from '../outbox/outbox.repository.js';
import type { Role } from '../auth/token.service.js';
import { InternalClient } from './internal.client.js';
import { CredentialsProjection } from './projections.js';

/**
 * Вхід у мікросервісній композиції.
 *
 * Пошук реквізитів не змінився взагалі — читаються ті самі дві таблиці, тільки
 * вони тепер власні. Змінилась ЗМІНА ЗОНИ, і саме вона показує, чого коштує
 * розʼїхана по базах людина.
 *
 * Зона — не дані входу. Від неї залежить генерація слотів (у розкладі) і
 * показ занять студентові (у білінгу), тому господар колонки — той сервіс, де
 * живе сама людина. Але запрос «зміни мені зону» приходить сюди, бо лише вхід
 * знає, ХТО його зробив: у токені лежить роль і номер, а не таблиця.
 *
 * Звідси порядок: спершу господар, потім власна копія. Якщо впаде другий крок,
 * у кабінеті зона вже нова, а в токені при наступному вході — ще стара, і
 * лікується це повторним збереженням. Якби порядок був обернений, розклад
 * генерував би слоти в старій зоні, а користувач бачив би нову — це гірше,
 * бо непомітно.
 */
@Injectable()
export class IdentityCredentialsAdapter implements CredentialsPort {
  private readonly log = new Logger('Identity');

  constructor(
    private readonly local: LocalCredentialsAdapter,
    private readonly internal: InternalClient,
    private readonly projection: CredentialsProjection,
    private readonly outbox: OutboxRepository,
    @Inject(KYSELY) private readonly db: Database,
  ) {}

  byEmail(email: string) {
    return this.local.byEmail(email);
  }

  async updateTimezone(id: number, role: Role, timezone: string) {
    const owner = role === 'teacher'
      ? await this.internal.post<{ id: number; name: string; timezone: string } | null>(
        'scheduling', `/internal/teachers/${id}/timezone`, { timezone },
      )
      : await this.internal.post<{ id: number; name: string; timezone: string } | null>(
        'billing', `/internal/students/${id}/timezone`, { timezone },
      );

    if (!owner) return null;

    try {
      await this.projection.setTimezone(role, id, timezone);
    } catch (e) {
      // Копія для входу розійшлась із господарем. Не відмовляємо: зона вже
      // змінена там, де від неї залежить розклад, а токен віддасть стару
      // зону лише до наступного збереження.
      this.log.warn(
        `копія зони ${role} ${id} не оновилась: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    return owner;
  }
  /* ──────────────── реєстрація: тут викладач народжується ──────────────── */

  /**
   * Завести викладача у ВЛАСНІЙ базі й розіслати профіль сусідам.
   *
   * Вставка сирим SQL із тієї ж причини, що й у проєкції: колонок ціни й
   * розкладу в базі входу немає, їх зрізано. Вхід тримає рівно те, чим
   * автентифікує.
   *
   * Розсилання — у ТІЙ САМІЙ транзакції, що й вставка, через журнал
   * відкладених доставок. Або є і викладач, і два завдання, або немає
   * нічого: інакше можливий акаунт, про який розклад ніколи не дізнається,
   * і людина з порожнім кабінетом без жодної помилки на екрані.
   */
  async createTeacher(reg: TeacherRegistration): Promise<IdentityRecord | null> {
    return this.db.transaction().execute(async (tx) => {
      const inserted = await sql<{ id: number; name: string; email: string }>`
        insert into teachers (name, email, password_hash, timezone, email_verified_at)
        values (${reg.name}, ${reg.email}, ${reg.passwordHash}, ${reg.timezone}, null)
        on conflict (email) do nothing
        returning id, name, email`.execute(tx);

      const row = inserted.rows[0];
      if (!row) return null;

      const profile = {
        id: row.id,
        name: row.name,
        email: row.email,
        timezone: reg.timezone,
        defaultPriceMinor: reg.defaultPriceMinor,
      };

      await this.outbox.add({ kind: 'scheduling.teacher', payload: profile }, null, tx);
      await this.outbox.add({ kind: 'billing.teacher', payload: profile }, null, tx);

      this.log.log(`викладач ${row.id} зареєстрований, профіль поставлений у чергу`);
      return { id: row.id, role: 'teacher' as const, name: row.name, email: row.email, emailVerified: false };
    });
  }

  /** Профіль читається з власної бази: усе, що потрібно листу, тут є. */
  identityById(id: number, role: Role) {
    return this.local.identityById(id, role);
  }

  /** Підтвердження пошти — справа входу й нікого більше. */
  markEmailVerified(id: number, at: Date) {
    return this.local.markEmailVerified(id, at);
  }

  /**
   * Пароль теж належить входу цілком: ні розклад, ні білінг його не бачать —
   * колонку `password_hash` у них зрізано. Тому нічого розсилати не треба.
   */
  setPassword(id: number, role: Role, passwordHash: string, at: Date) {
    return this.local.setPassword(id, role, passwordHash, at);
  }

}
