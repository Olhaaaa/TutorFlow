/**
 * Виконувана специфікація МЕЖІ між сервісами: таблиця маршрутів gateway і різ
 * схеми по службах.
 *
 * Бази не потребує, і це не випадково. І маршрутизація, і розподіл колонок —
 * чисті дані: перелік правил і перелік того, що кожна база втрачає. Саме тому
 * помилку в межі видно тестом, а не прогоном компоузу на десять контейнерів.
 */
import { describe, expect, it } from 'vitest';
import { CUTS } from '../src/lab3/cut.js';
import { routeFor } from '../src/lab3/gateway.routes.js';
import { SERVICES, UnknownServiceError, parseServiceRole } from '../src/lab3/roles.js';

describe('маршрутизація gateway', () => {
  it('вхід іде в сервіс входу', () => {
    expect(routeFor('/api/auth/login')).toBe('identity');
  });

  it('усе невідоме йде в розклад: у ньому більшість маршрутів', () => {
    expect(routeFor('/api/slots')).toBe('scheduling');
    expect(routeFor('/api/slots/42/book')).toBe('scheduling');
    expect(routeFor('/api/teacher/availability')).toBe('scheduling');
    expect(routeFor('/api/calendar/abc.ics')).toBe('scheduling');
    expect(routeFor('/api/teacher/maintenance')).toBe('scheduling');
  });

  it('гроші йдуть у білінг', () => {
    expect(routeFor('/api/balance')).toBe('billing');
    expect(routeFor('/api/balance/history')).toBe('billing');
    expect(routeFor('/api/teacher/students')).toBe('billing');
    expect(routeFor('/api/teacher/students/3/topup')).toBe('billing');
    expect(routeFor('/api/payments/webhook')).toBe('billing');
  });

  /**
   * Головна пастка таблиці префіксів: `/api/me` належить входу, а
   * `/api/me/telegram` — каналу нагадувань. За зворотного порядку правил
   * привʼязка чату поїхала б не туди, і помилку було б видно лише в компоузі.
   */
  it('довший префікс виграє в коротшого', () => {
    expect(routeFor('/api/me')).toBe('identity');
    expect(routeFor('/api/me/timezone')).toBe('identity');
    expect(routeFor('/api/me/telegram')).toBe('notifications');
  });

  /** Префікс мусить збігатися по СЕГМЕНТУ, а не по рядку. */
  it('схожа назва не перехоплює чужий маршрут', () => {
    expect(routeFor('/api/balances-report')).toBe('scheduling');
    expect(routeFor('/api/metrics')).toBe('scheduling');
  });
});

describe('роль сервіса з команди', () => {
  it('приймає всі пʼять', () => {
    for (const s of SERVICES) expect(parseServiceRole(s)).toBe(s);
  });

  it('не зважає на регістр і пробіли', () => {
    expect(parseServiceRole(' Billing ')).toBe('billing');
  });

  it('описка валить процес на старті, а не дає сервіс, який тихо мовчить', () => {
    expect(() => parseServiceRole('shceduling')).toThrow(UnknownServiceError);
    expect(() => parseServiceRole(undefined)).toThrow(/не задано/);
    expect(() => parseServiceRole('')).toThrow(UnknownServiceError);
  });
});

/**
 * Колонки таблиць `teachers` і `students` — як вони описані у schema.ts.
 *
 * Перелік тут повторений свідомо: тест мусить ловити саме розбіжність між
 * схемою й різом. Якщо колонку додали в міграції й забули вирішити, чия вона,
 * тест упаде на першій же перевірці — і це правильний момент, щоб про це
 * думати.
 */
const TEACHERS = [
  'id', 'name', 'email', 'password_hash', 'timezone', 'default_price_minor',
  'cancel_hours', 'payment_deadline_hours', 'reminder_lead_hours',
  'payment_provider', 'payment_token_encrypted', 'payments_connected_at',
  'calendar_token', 'created_at',
];

const STUDENTS = [
  'id', 'teacher_id', 'name', 'email', 'password_hash', 'balance_minor',
  'timezone', 'telegram_chat_id', 'telegram_link_code', 'calendar_token',
  'created_at',
];

const ROLES = ['identity', 'scheduling', 'billing', 'notifications'] as const;

/** Де колонка ВИЖИЛА після різу. */
function survivesIn(table: 'teachers' | 'students', column: string): string[] {
  return ROLES.filter((role) => {
    const cut = CUTS[role];
    if (cut.tables.includes(table)) return false;
    const dropped = cut.columns.find((c) => c.table === table)?.columns ?? [];
    return !dropped.includes(column);
  });
}

describe('різ схеми по межі сервісів', () => {
  it('кожна колонка лишилась хоч у когось', () => {
    const lost = [
      ...TEACHERS.filter((c) => survivesIn('teachers', c).length === 0)
        .map((c) => `teachers.${c}`),
      ...STUDENTS.filter((c) => survivesIn('students', c).length === 0)
        .map((c) => `students.${c}`),
    ];
    expect(lost).toEqual([]);
  });

  /**
   * Реквізити ВИКЛАДАЧА — рівно в сервісі входу. Це не стиль, а межа
   * компрометації: сервіс, який хеша не має, не може його й віддати.
   */
  it('реквізити викладача лишились лише у сервісі входу', () => {
    expect(survivesIn('teachers', 'password_hash')).toEqual(['identity']);
    expect(survivesIn('teachers', 'email')).toEqual(['identity']);
  });

  /**
   * А ось у студента хеш лишився ДВІЧІ — і це визнаний борг, а не недогляд.
   *
   * Студента створює білінг: `POST /api/teacher/students` — його маршрут, бо
   * це рядок із балансом. Колонка `password_hash` у схемі `not null`, і
   * вставка без неї не пройде, тому білінг пише хеш у свою копію й більше
   * ніколи його не читає; господар реквізитів — вхід, куди вони їдуть
   * завданням із outbox.
   *
   * Прибрати колонку в білінгу означало б розвести вставку студента в двох
   * архітектурах — тобто зламати те, заради чого вся лабораторна й робиться.
   * Правильне рішення — реєстрація через сервіс входу, і воно за межами
   * цієї роботи.
   */
  it('хеш студента лишився в білінгу як борг: пише, але не читає', () => {
    expect(survivesIn('students', 'password_hash')).toEqual(['identity', 'billing']);
    expect(survivesIn('students', 'email')).toEqual(['identity', 'billing']);
  });

  /** Токен мерчанта не їздить по мережі навіть між нашими сервісами. */
  it('еквайринг викладача лишився лише в білінгу', () => {
    expect(survivesIn('teachers', 'payment_token_encrypted')).toEqual(['billing']);
    expect(survivesIn('teachers', 'payment_provider')).toEqual(['billing']);
  });

  it('баланс — лише в білінгу, привʼязка чату — лише в нагадуваннях', () => {
    expect(survivesIn('students', 'balance_minor')).toEqual(['billing']);
    expect(survivesIn('students', 'telegram_chat_id')).toEqual(['notifications']);
    expect(survivesIn('students', 'telegram_link_code')).toEqual(['notifications']);
  });

  /**
   * Імʼя й зона дублюються свідомо: без імені розклад не підпише заняття, а
   * канал не привітається людиною. Ціна дубля — узгодженість, і платиться
   * вона розсилкою зміни зони.
   */
  it('імʼя й зона лишились у всіх, кому треба показувати людину', () => {
    expect(survivesIn('students', 'name').length).toBeGreaterThan(1);
    expect(survivesIn('students', 'timezone').length).toBeGreaterThan(1);
  });

  it('розклад не має доступу до студентів, а нагадування — до занять', () => {
    expect(CUTS.scheduling.tables).toContain('students');
    expect(CUTS.scheduling.tables).toContain('transactions');
    expect(CUTS.notifications.tables).toContain('slots');
    expect(CUTS.notifications.tables).toContain('transactions');
    expect(CUTS.billing.tables).toContain('slots');
    expect(CUTS.identity.tables).toContain('slots');
    expect(CUTS.identity.tables).toContain('transactions');
  });

  /** Журнал відкладених доставок потрібен кожному: він про спосіб, не про домен. */
  it('outbox не прибирається ні в кого', () => {
    for (const role of ROLES) expect(CUTS[role].tables).not.toContain('outbox');
  });
});
