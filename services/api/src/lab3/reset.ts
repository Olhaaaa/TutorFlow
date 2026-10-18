/**
 * Скид демо-даних в усіх базах лабораторної 3.
 *
 *   node dist/lab3/reset.js
 *
 * Чому одна команда на чотири бази, а не чотири контейнери: дані мусять бути
 * ТІ САМІ, з тими самими ідентифікаторами. Студент №2 у білінгу й студент №2 у
 * нагадуваннях — це та сама людина, і тримається ця рівність лише на тому, що
 * сідер детермінований: він починає з `truncate … restart identity` і вставляє
 * рядки у фіксованому порядку.
 *
 * Кожна база проходить чотири кроки: схема з нуля → спільні міграції →
 * демо-дані → різ по межі. Саме в такому порядку: сідер наповнює ПОВНУ схему
 * (інакше він не зміг би вставити ні слоти, ні проводки), і лише потім з бази
 * прибирається все, що цьому сервісу не належить.
 *
 * Потрібен для навантажувальних сценаріїв: `contention.js` і `load.js`
 * витрачають слоти, тому перед кожним прогоном дані мусять бути однакові.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { sql } from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { createDatabase } from '../db/database.module.js';
import { seed } from '../db/seed.js';
import { cutDatabase } from './cut.js';
import { databaseUrlFor } from './config.js';

const ROLES = ['identity', 'scheduling', 'billing', 'notifications'] as const;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('відмова: скид демо-даних не запускається в продакшні');
    process.exit(1);
  }

  for (const role of ROLES) {
    console.log(`\n=== ${role} ===`);
    const db = createDatabase(databaseUrlFor(role));

    // Схема з нуля, бо різ попереднього прогону вже прибрав таблиці, а
    // міграції вважають їх накладеними: журнал міграцій ними ж і ведеться.
    // `if exists` не для краси: прогін, який упав посеред роботи, лишає базу
    // без схеми взагалі, і наступний запуск мусить її полікувати, а не впасти
    // на тому самому місці.
    await sql`drop schema if exists public cascade`.execute(db);
    await sql`create schema public`.execute(db);

    const migrator = new Migrator({
      db,
      provider: new FileMigrationProvider({
        fs, path,
        migrationFolder: path.join(import.meta.dirname, '..', 'db', 'migrations'),
      }),
    });
    const { error } = await migrator.migrateToLatest();
    if (error) {
      console.error('міграція не пройшла:', error);
      process.exit(1);
    }

    await seed(db);
    const cuts = await cutDatabase(db, role);
    console.log(`  різ: ${cuts.length} змін`);

    await db.destroy();
  }

  console.log('\nдемо-дані однакові в усіх чотирьох базах');
}

void main();
