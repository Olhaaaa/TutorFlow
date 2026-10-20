/**
 * Міграція на вже РОЗРІЗАНІЙ базі.
 *
 * Схема лабораторної 3 народжується так: спільні міграції, потім різ по межі
 * сервіса (lab3/cut.ts). Поки бази піднімаються з нуля — сідером чи першим
 * деплоєм, — міграції бачать повну схему, і будь-яка з них проходить. Але
 * міграція, яка з'являється ПІСЛЯ першого деплою, накладається вже на базу без
 * чужих таблиць. Перший деплой 0010_auth_email у GKE саме так і впав: у базі
 * нагадувань немає `teachers`, а міграція робила `alter table teachers`.
 *
 * Тест відтворює цей шлях для кожної досяжної точки історії (див.
 * FIRST_CUT_AWARE) і кожного сервіса: накласти
 * міграції до N-ї, розрізати, накласти решту, розрізати ще раз — як робить
 * lab3/migrate.js при кожному деплої. Умов дві: шлях проходить без помилки, і
 * схема на виході та сама, що в бази, піднятої з нуля. Друга умова ловить
 * міграцію, яка «пройшла», бо тихо нічого не зробила там, де мала.
 *
 * Потрібна піднята локальна база: docker compose -f compose.dev.yml up -d.
 * Тест створює власну тимчасову базу й прибирає її за собою.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { sql } from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { createDatabase, type Database } from '../src/db/database.module.js';
import { CUTS, cutDatabase } from '../src/lab3/cut.js';

const SCRATCH = 'tutorflow_migrate_after_cut';

/**
 * Перша міграція, яка мусить уміти накладатись на розрізану базу.
 *
 * Усе ДО неї існувало раніше, ніж хоч одна база була розрізана: бази лаби 3
 * народжувались із повною історією (reset або перший деплой) і різались уже
 * після. Тому 0002…0009 ніколи не побачать розрізаної бази й писались без
 * `if exists` — і переписувати історію заради шляху, якого не буває, не
 * треба. Точки різу, які тут перевіряються, — від останньої міграції ПЕРЕД
 * цією межею й далі. Кожна нова міграція автоматично потрапляє під перевірку.
 */
const FIRST_CUT_AWARE = '0010_auth_email';
const ROLES = Object.keys(CUTS) as (keyof typeof CUTS)[];

const admin = createDatabase();
let db: Database;

const provider = new FileMigrationProvider({
  fs,
  path,
  migrationFolder: path.join(import.meta.dirname, '..', 'src', 'db', 'migrations'),
});

function migrator(): Migrator {
  return new Migrator({ db, provider });
}

/** Порожня схема — як у lab3/reset.ts: різ попереднього прогону вже прибрав таблиці. */
async function emptySchema(): Promise<void> {
  await sql`drop schema if exists public cascade`.execute(db);
  await sql`create schema public`.execute(db);
}

async function mustSucceed(run: Promise<{ error?: unknown }>, what: string): Promise<void> {
  const { error } = await run;
  if (error) {
    throw new Error(`${what}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Схема як дані: таблиця → відсортовані колонки. Журнал міграцій сюди не входить. */
async function schemaOf(): Promise<Record<string, string[]>> {
  const rows = await sql<{ table_name: string; column_name: string }>`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public' and table_name not like 'kysely_%'
    order by table_name, column_name`.execute(db);

  const out: Record<string, string[]> = {};
  for (const r of rows.rows) (out[r.table_name] ??= []).push(r.column_name);
  return out;
}

let names: string[] = [];

beforeAll(async () => {
  await sql.raw(`drop database if exists ${SCRATCH}`).execute(admin);
  await sql.raw(`create database ${SCRATCH}`).execute(admin);

  const url = new URL(config.databaseUrl);
  url.pathname = `/${SCRATCH}`;
  db = createDatabase(url.toString());

  // Kysely впорядковує міграції за іменем — так само й тут.
  names = Object.keys(await provider.getMigrations()).sort();
}, 60_000);

afterAll(async () => {
  await db?.destroy();
  await sql.raw(`drop database if exists ${SCRATCH} with (force)`).execute(admin);
  await admin.destroy();
});

describe('міграції після різу (лаба 3)', () => {
  it('межа відома й після неї є що перевіряти', () => {
    // Захист від тесту, який «проходить», бо не знайшов жодної точки різу:
    // перейменована міграція тихо вимкнула б усю перевірку.
    expect(names).toContain(FIRST_CUT_AWARE);
    expect(names.indexOf(FIRST_CUT_AWARE)).toBeGreaterThan(0);
  });

  for (const role of ROLES) {
    it(`${role}: різ після будь-якої досяжної міграції, потім решта — та сама схема, що з нуля`, async () => {
      // Еталон: база з нуля, як після reset або першого деплою.
      await emptySchema();
      await mustSucceed(migrator().migrateToLatest(), `${role}: міграції з нуля`);
      await cutDatabase(db, role);
      const expected = await schemaOf();

      // Різ після кожної досяжної точки, крім останньої міграції: далі
      // накладається решта. Найраніша досяжна — остання перед межею.
      const from = names.indexOf(FIRST_CUT_AWARE) - 1;
      for (const cutAfter of names.slice(from, -1)) {
        await emptySchema();
        await mustSucceed(migrator().migrateTo(cutAfter), `${role}: міграції до ${cutAfter}`);
        await cutDatabase(db, role);

        await mustSucceed(
          migrator().migrateToLatest(),
          `${role}: база розрізана після ${cutAfter}, наступні міграції не накладаються`,
        );
        await cutDatabase(db, role);

        expect(await schemaOf(), `${role}: різ після ${cutAfter} дав іншу схему`).toEqual(expected);
      }
    }, 300_000);
  }
});
