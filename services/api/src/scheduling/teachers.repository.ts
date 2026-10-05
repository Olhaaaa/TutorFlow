import { Inject, Injectable } from '@nestjs/common';
import type { PaymentProviderColumn } from '../db/schema.js';
import { KYSELY, type Database } from '../db/database.module.js';
import type { Executor } from './slots.repository.js';

/** Таблиця `teachers` належить модулю розкладу: з неї беруться правила. */
@Injectable()
export class TeachersRepository {
  constructor(@Inject(KYSELY) private readonly root: Database) {}

  /** Для входу: разом із хешем пароля, тому назовні не віддається. */
  async byEmailWithSecret(email: string, tx?: Executor) {
    return (
      (await (tx ?? this.root)
        .selectFrom('teachers')
        .select(['id', 'name', 'email', 'password_hash', 'timezone'])
        .where('email', '=', email)
        .executeTakeFirst()) ?? null
    );
  }

  /** Платіжні реквізити викладача. Шифротекст назовні з сервісу не виходить. */
  async paymentCredentials(id: number, tx?: Executor) {
    const row = await (tx ?? this.root)
      .selectFrom('teachers')
      .select(['payment_provider', 'payment_token_encrypted', 'payments_connected_at'])
      .where('id', '=', id)
      .executeTakeFirst();

    return row ?? null;
  }

  async setPaymentCredentials(
    id: number,
    p: { provider: PaymentProviderColumn; encrypted: string },
    tx?: Executor,
  ) {
    return (tx ?? this.root)
      .updateTable('teachers')
      .set({
        payment_provider: p.provider,
        payment_token_encrypted: p.encrypted,
        payments_connected_at: new Date(),
      })
      .where('id', '=', id)
      .returning(['id', 'payment_provider', 'payments_connected_at'])
      .executeTakeFirstOrThrow();
  }

  /** Відключення. Усі три поля гасяться разом — цього вимагає обмеження бази. */
  async clearPaymentCredentials(id: number, tx?: Executor) {
    return (tx ?? this.root)
      .updateTable('teachers')
      .set({
        payment_provider: null,
        payment_token_encrypted: null,
        payments_connected_at: null,
      })
      .where('id', '=', id)
      .returning('id')
      .executeTakeFirst();
  }

  /** Зміна власного часового поясу. Викладач — така сама людина, як і студент. */
  async updateTimezone(id: number, timezone: string, tx?: Executor) {
    const row = await (tx ?? this.root)
      .updateTable('teachers')
      .set({ timezone })
      .where('id', '=', id)
      .returning(['id', 'name', 'timezone'])
      .executeTakeFirst();

    return row ?? null;
  }

  async byId(id: number, tx?: Executor) {
    return (
      (await (tx ?? this.root)
        .selectFrom('teachers')
        .select(['id', 'timezone', 'cancel_hours', 'payment_deadline_hours', 'default_price_minor'])
        .where('id', '=', id)
        .executeTakeFirst()) ?? null
    );
  }
}
