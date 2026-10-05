import { Inject, Injectable } from '@nestjs/common';
import { KYSELY, type Database } from '../db/database.module.js';
import type { Executor } from '../scheduling/slots.repository.js';

/** Таблиця `students` належить модулю білінгу: на ній тримається баланс. */
@Injectable()
export class StudentsRepository {
  constructor(@Inject(KYSELY) private readonly root: Database) {}

  private db(tx?: Executor): Executor { return tx ?? this.root; }

  async byId(id: number, tx?: Executor) {
    return (
      (await this.db(tx)
        .selectFrom('students')
        .select(['id', 'teacher_id', 'name', 'email', 'balance_minor', 'timezone'])
        .where('id', '=', id)
        .executeTakeFirst()) ?? null
    );
  }

  async listByTeacher(teacherId: number, tx?: Executor) {
    return this.db(tx)
      .selectFrom('students')
      .select(['id', 'name', 'email', 'balance_minor', 'timezone'])
      .where('teacher_id', '=', teacherId)
      .orderBy('name')
      .execute();
  }

  async create(
    teacherId: number,
    s: { name: string; email: string; passwordHash: string; timezone: string },
    tx?: Executor,
  ) {
    return this.db(tx)
      .insertInto('students')
      .values({
        teacher_id: teacherId,
        name: s.name,
        email: s.email,
        password_hash: s.passwordHash,
        timezone: s.timezone,
      })
      .returning(['id', 'name', 'email', 'balance_minor', 'timezone'])
      .executeTakeFirstOrThrow();
  }

  /**
   * Зсунути кешований баланс на дельту й повернути нове значення.
   *
   * ПРАВИЛО: викликати лише разом із записом у журнал транзакцій і в тій самій
   * транзакції БД. Журнал — джерело істини, це поле лише кеш; зсув без запису
   * розсинхронізує їх, і звірка `audit` це покаже.
   *
   * Саме UPDATE з арифметикою в SQL, а не читання з наступним записом:
   * інакше два одночасні поповнення затерли б одне одного. База рахує приріст
   * атомарно в межах рядка.
   */
  async shiftBalance(studentId: number, deltaMinor: number, tx?: Executor) {
    const row = await this.db(tx)
      .updateTable('students')
      .set((eb) => ({ balance_minor: eb('balance_minor', '+', deltaMinor) }))
      .where('id', '=', studentId)
      .returning(['id', 'balance_minor'])
      .executeTakeFirst();

    return row ?? null;
  }
}
