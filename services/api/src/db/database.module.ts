import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';
import { config } from '../config.js';
import type { DB } from './schema.js';

/**
 * `bigint` (OID 20) драйвер за замовчуванням віддає РЯДКОМ — щоб не втратити
 * точність на значеннях, більших за 2^53. Через це `bigserial`-ключі
 * приходили як `"1"`, хоча в схемі описані числом, і це просочувалось аж у
 * JSON відповіді.
 *
 * Для ідентифікаторів цього проєкту межа 2^53 недосяжна, тому читаємо їх
 * числом і робимо описані типи правдивими. Якщо колись зʼявиться колонка з
 * справді великими значеннями, парсер треба буде звузити до конкретних
 * стовпців, а не до всього типу.
 */
types.setTypeParser(types.builtins.INT8, (value) => Number(value));

export const KYSELY = 'KYSELY';
export type Database = Kysely<DB>;

export function createDatabase(connectionString = config.databaseUrl): Database {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, max: 10 }) }),
  });
}

@Global()
@Module({
  providers: [{ provide: KYSELY, useFactory: () => createDatabase() }],
  exports: [KYSELY],
})
export class DatabaseModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    // пул закривається разом із застосунком, інакше Cloud Run не загасить контейнер
  }
}
