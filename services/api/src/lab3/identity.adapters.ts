import { Injectable, Logger } from '@nestjs/common';
import { LocalCredentialsAdapter } from '../auth/credentials.adapter.js';
import type { CredentialsPort } from '../auth/ports.js';
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
}
