import { sql } from 'kysely';
import type { Database } from '../db/database.module.js';
import type { ServiceRole } from './roles.js';

/**
 * РІЗ ПО МЕЖІ: як одна схема перетворюється на чотири бази.
 *
 * Міграції для всіх сервісів ті самі — ті самі файли, що й у моноліті, і це
 * умова порівняння: якби схеми різнились, різниця в замірах могла б бути
 * різницею схем, а не архітектур. Тому кожна база спершу отримує СХЕМУ
 * ЦІЛКОМ, а потім з неї прибирається все, що цьому сервісу не належить.
 *
 * Прибирається по-справжньому, а не «не використовується»: таблиця зникає,
 * колонка зникає. Через це випадкове звернення за межу падає з помилкою бази,
 * а не повертає тихо застарілий рядок. Саме цього й хочеться від межі — щоб
 * її неможливо було перетнути непомітно.
 *
 * Правило розподілу колонок: у кожної ОДИН господар.
 *
 *   teachers.password_hash, email        → вхід
 *   teachers.timezone, *_hours, calendar_token, default_price_minor → розклад
 *   teachers.payment_*                   → білінг (еквайринг — це гроші)
 *   students.password_hash, email        → вхід
 *   students.balance_minor, calendar_token → білінг
 *   students.telegram_*                  → нагадування
 *   students.name, timezone              → копія в кожного, хто показує людину
 *
 * Імʼя й зона дублюються свідомо: без імені розклад не підпише заняття, а
 * канал не привітається, і ходити за ними по мережі на кожен рядок дорожче,
 * ніж тримати копію. Ціна дубля — узгодженість: зміну зони розносить сервіс
 * входу, і робить це не атомарно.
 */
export interface Cut {
  /** Таблиці, яких у цій базі не повинно бути. */
  tables: string[];
  /** Колонки, господар яких — інший сервіс. */
  columns: { table: string; columns: string[] }[];
}

/**
 * Експортується заради тесту: він перевіряє те, чого не перевірить компілятор —
 * що жодна колонка не прибрана ОДРАЗУ З УСІХ баз і що секрети лишились рівно в
 * того, хто ними розпоряджається.
 */
export const CUTS: Record<Exclude<ServiceRole, 'gateway'>, Cut> = {
  identity: {
    tables: [
      'availability_rules', 'enrollments', 'slots', 'external_busy',
      'transactions', 'payments', 'notifications',
    ],
    columns: [
      {
        table: 'teachers',
        columns: [
          'default_price_minor', 'cancel_hours', 'payment_deadline_hours',
          'reminder_lead_hours', 'payment_provider', 'payment_token_encrypted',
          'payments_connected_at', 'calendar_token',
        ],
      },
      {
        table: 'students',
        columns: ['balance_minor', 'telegram_chat_id', 'telegram_link_code', 'calendar_token'],
      },
    ],
  },

  scheduling: {
    // students іде з каскадом, і разом із ним зникає зовнішній ключ
    // slots.student_id: саме він не дав би заброньувати слот студентові,
    // якого в цій базі немає.
    tables: ['students', 'transactions', 'payments', 'notifications'],
    columns: [
      {
        table: 'teachers',
        columns: [
          'email', 'password_hash',
          'payment_provider', 'payment_token_encrypted', 'payments_connected_at',
        ],
      },
    ],
  },

  billing: {
    tables: ['availability_rules', 'enrollments', 'slots', 'external_busy', 'notifications'],
    columns: [
      {
        table: 'teachers',
        columns: [
          'email', 'password_hash', 'timezone', 'default_price_minor',
          'cancel_hours', 'payment_deadline_hours', 'reminder_lead_hours',
          'calendar_token',
        ],
      },
      { table: 'students', columns: ['telegram_chat_id', 'telegram_link_code'] },
    ],
  },

  notifications: {
    tables: [
      'teachers', 'availability_rules', 'enrollments', 'slots',
      'external_busy', 'transactions', 'payments',
    ],
    columns: [
      {
        table: 'students',
        columns: ['teacher_id', 'email', 'password_hash', 'balance_minor', 'calendar_token'],
      },
    ],
  },
};

/**
 * Прибрати з бази все, що цьому сервісу не належить.
 *
 * Ідемпотентно: `if exists` усюди, тому повторний запуск нічого не ламає, а
 * накладання міграцій і різ можна робити однією командою скільки разів треба.
 */
export async function cutDatabase(
  db: Database,
  role: Exclude<ServiceRole, 'gateway'>,
): Promise<string[]> {
  const cut = CUTS[role];
  const done: string[] = [];

  for (const table of cut.tables) {
    // cascade обовʼязковий: разом із таблицею мусять зникнути зовнішні ключі,
    // які на неї посилаються. Саме вони й є технічним виразом межі, яку ми
    // розрізаємо.
    await sql.raw(`drop table if exists ${table} cascade`).execute(db);
    done.push(`− таблиця ${table}`);
  }

  for (const { table, columns } of cut.columns) {
    for (const column of columns) {
      await sql.raw(`alter table ${table} drop column if exists ${column} cascade`).execute(db);
    }
    done.push(`− ${table}: ${columns.join(', ')}`);
  }

  return done;
}

/** Чи має цей сервіс власну базу. У gateway її немає взагалі. */
export function hasDatabase(role: ServiceRole): role is Exclude<ServiceRole, 'gateway'> {
  return role !== 'gateway';
}
