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

  /**
   * Строк нагадування кожного викладача.
   *
   * Віддається списком, бо прохід нагадувань рахує вікно не одне, а по одному
   * на кожне ВІДМІННЕ значення строку: формула вікна лишається в ядрі, а не
   * розтікається у SQL із `make_interval` по колонці.
   */
  reminderLeads(tx?: Executor) {
    return (tx ?? this.root)
      .selectFrom('teachers')
      .select(['id', 'reminder_lead_hours'])
      .execute();
  }

  /* ---------- секретна адреса календаря ---------- */

  /**
   * Токен стрічки. Створюється при першому зверненні.
   *
   * Умова `calendar_token is null` всередині UPDATE, а не перевірка в коді:
   * два одночасні відкриття екрана інакше створили б два токени, і той, що
   * викладач уже вставив у календар, перестав би працювати.
   */
  async ensureCalendarToken(id: number, token: string, tx?: Executor) {
    await (tx ?? this.root)
      .updateTable('teachers')
      .set({ calendar_token: token })
      .where('id', '=', id)
      .where('calendar_token', 'is', null)
      .execute();

    const row = await (tx ?? this.root)
      .selectFrom('teachers')
      .select(['id', 'name', 'timezone', 'calendar_token'])
      .where('id', '=', id)
      .executeTakeFirst();

    return row ?? null;
  }

  /** Хто власник цієї стрічки. Єдиний спосіб автентифікації для .ics. */
  async byCalendarToken(token: string, tx?: Executor) {
    const row = await (tx ?? this.root)
      .selectFrom('teachers')
      .select(['id', 'name', 'timezone'])
      .where('calendar_token', '=', token)
      .executeTakeFirst();

    return row ?? null;
  }

  /** Відкликати стрічку: стара адреса перестає працювати негайно. */
  async clearCalendarToken(id: number, tx?: Executor) {
    await (tx ?? this.root)
      .updateTable('teachers')
      .set({ calendar_token: null })
      .where('id', '=', id)
      .execute();
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
