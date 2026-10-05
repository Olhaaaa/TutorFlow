import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * У розробці змінні беруться з `.env` у корені монорепозиторію — його читає
 * сам Node, без жодної бібліотеки (`process.loadEnvFile` є з Node 20.12).
 *
 * Це робиться тут, а не у флагах npm-скриптів, бо точок входу вже чотири:
 * сервер, міграції, сідер і vitest. Інакше кожна з них мусила б памʼятати про
 * `--env-file`, і тести падали б із «не задано DATABASE_URL» у того, хто про
 * це не знає.
 *
 * Уже задані змінні оточення мають пріоритет — у Cloud Run файлу немає взагалі,
 * і підміняти ними секрети платформи не можна.
 */
const ENV_FILE = join(import.meta.dirname, '..', '..', '..', '.env');
if (process.env.NODE_ENV !== 'production' && existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE);
}

/** Читання й перевірка оточення. Падати на старті краще, ніж на першому запросі. */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`не задано змінну оточення ${name} — див. .env.example`);
  return v;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.PORT ?? 8080),
  jwtSecret: required('JWT_SECRET'),
  /** Зона викладача. Використовується при генерації слотів із настінного часу. */
  teacherTimezone: process.env.TEACHER_TIMEZONE ?? 'Europe/Kyiv',

  /**
   * Зовнішня адреса застосунку — її отримує провайдер як webHookUrl.
   * Локально вебхук нікуди не прийде без тунелю, тому значення необовʼязкове:
   * без нього створення рахунку просто відмовляє з виразним повідомленням.
   */
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? null,

  /**
   * Як часто застосовувати переходи станів за часом: звільняти неоплачені
   * закріплення, закривати проведені заняття, протерміновувати рахунки.
   * 0 вимикає таймер — зручно в тестах і тоді, коли цим займається воркер.
   */
  maintenanceIntervalSec: Number(process.env.MAINTENANCE_INTERVAL_SEC ?? 300),

  /** Скільки хвилин живе невиплачений рахунок. Збігається з validity у провайдера. */
  paymentValidityMinutes: Number(process.env.PAYMENT_VALIDITY_MINUTES ?? 60),

  /**
   * Ключ шифрування платіжних токенів викладачів. Без нього підключити
   * еквайринг не можна — застосунок при цьому працює, просто вкладка «Оплата»
   * відповідає 503. Окремий від JWT_SECRET навмисно: різна ціна витоку.
   */
  paymentTokenKey: process.env.PAYMENT_TOKEN_KEY ?? null,

  monobank: {
    /**
     * Запасний токен на рівні розгортання. Використовується лише для
     * викладачів, які не підключили власний рахунок, — зручно для
     * одноосібного розгортання й для демонстрації.
     */
    token: process.env.MONOBANK_TOKEN ?? null,
    apiBase: process.env.MONOBANK_API_BASE ?? 'https://api.monobank.ua',
  },
};
