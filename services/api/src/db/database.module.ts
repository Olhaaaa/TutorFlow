import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Kysely, PostgresDialect, type Transaction } from 'kysely';
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

/**
 * Куди виконувати запрос: у з'єднання чи в транзакцію.
 *
 * Тип живе в шарі бази, а не в репозиторії слотів, де був раніше. Його
 * приймають усі репозиторії й усі порти між модулями — тобто він описує
 * ДОСТУП ДО ДАНИХ, а не розклад. Доки він лежав у `scheduling`, кожен модуль
 * білінгу, який просто хотів виконати запрос у чужій транзакції, мусив
 * імпортувати щось із сусідньої вертикалі.
 */
export type Executor = Database | Transaction<DB>;

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
