import { Inject, Injectable } from '@nestjs/common';
import { KYSELY, type Database } from '../db/database.module.js';
import type { Executor } from './slots.repository.js';

/** Таблиця `teachers` належить модулю розкладу: з неї беруться правила. */
@Injectable()
export class TeachersRepository {
  constructor(@Inject(KYSELY) private readonly root: Database) {}

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
