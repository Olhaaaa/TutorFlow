import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { config } from '../config.js';
import type { DB } from './schema.js';

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
