/**
 * Схема сервіса: ті самі міграції плюс різ по межі.
 *
 *   node dist/lab3/migrate.js <сервіс>
 *
 * Запускається окремим одноразовим контейнером на кожну базу, як і в
 * лабораторній 2: кілька екземплярів сервіса, які починають мігрувати базу
 * навперебій, — найдешевший спосіб отримати половину схеми.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { createDatabase } from '../db/database.module.js';
import { cutDatabase, hasDatabase } from './cut.js';
import { parseServiceRole } from './roles.js';

async function main(): Promise<void> {
  const role = parseServiceRole(process.argv[2]);
  if (!hasDatabase(role)) {
    console.log(`${role}: власної бази немає, міграції не потрібні`);
    return;
  }

  const db = createDatabase();
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      // Міграції спільні для всіх сервісів: саме це й робить порівняння
      // архітектур коректним.
      migrationFolder: path.join(import.meta.dirname, '..', 'db', 'migrations'),
    }),
  });

  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    const mark = r.status === 'Success' ? 'OK  ' : r.status === 'Error' ? 'FAIL' : 'SKIP';
    console.log(`${mark} up ${r.migrationName}`);
  }

  if (error) {
    console.error('міграція не пройшла:', error);
    await db.destroy();
    process.exit(1);
  }

  console.log(`\nріз по межі сервіса ${role}:`);
  for (const line of await cutDatabase(db, role)) console.log(`  ${line}`);

  await db.destroy();
}

void main();
