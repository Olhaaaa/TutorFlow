/**
 * Запуск міграцій окремою командою, а НЕ при старті застосунку.
 * Cloud Run може підняти кілька екземплярів одночасно, і вони почали б
 * мігрувати базу навперебій.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { createDatabase } from './database.module.js';

async function main(): Promise<void> {
  const direction = process.argv[2] ?? 'up';
  const db = createDatabase();
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(import.meta.dirname, 'migrations'),
    }),
  });

  const { error, results } = direction === 'down'
    ? await migrator.migrateDown()
    : await migrator.migrateToLatest();

  for (const r of results ?? []) {
    const mark = r.status === 'Success' ? 'OK  ' : r.status === 'Error' ? 'FAIL' : 'SKIP';
    console.log(`${mark} ${r.direction} ${r.migrationName}`);
  }

  await db.destroy();

  if (error) {
    console.error('міграція не пройшла:', error);
    process.exit(1);
  }
  if (!results?.length) console.log('нічого застосовувати, схема актуальна');
}

void main();
