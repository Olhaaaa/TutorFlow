/**
 * Таблиця маршрутизації: який префікс якому сервісу.
 *
 * Правила впорядковані, і перше, що підійшло, виграє — тому довші префікси
 * стоять вище за коротші. Це не дрібниця: `/api/me/telegram` належить каналу
 * нагадувань, а `/api/me` — входу, і за зворотного порядку привʼязка чату
 * поїхала б не туди.
 *
 * Маршрутизація йде за ШЛЯХОМ, а не за токеном, і це свідомо: gateway не
 * розбирає токен і взагалі не знає, хто такий користувач. Його справа —
 * доставити запрос у потрібний сервіс; хто цей користувач, кожен сервіс
 * зʼясовує сам, перевіривши підпис. Інакше gateway став би місцем, яке мусить
 * знати все про всіх.
 *
 * Правило за замовчуванням — розклад: у ньому більшість маршрутів застосунку
 * (сітка, бронювання, шаблон доступності, стрічки `.ics`), і перелічувати їх
 * по одному означало б забути черговий при наступній зміні.
 */
import type { ServiceRole } from './roles.js';

export type UpstreamService = Exclude<ServiceRole, 'gateway'>;

interface Rule {
  prefix: string;
  service: UpstreamService;
}

const RULES: Rule[] = [
  { prefix: '/api/auth', service: 'identity' },
  { prefix: '/api/me/telegram', service: 'notifications' },
  { prefix: '/api/me', service: 'identity' },
  { prefix: '/api/balance', service: 'billing' },
  { prefix: '/api/teacher/students', service: 'billing' },
  { prefix: '/api/payments', service: 'billing' },
];

const DEFAULT_SERVICE: UpstreamService = 'scheduling';

/** Куди йде цей запрос. Шлях — без рядка запросу. */
export function routeFor(pathname: string): UpstreamService {
  const rule = RULES.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  return rule?.service ?? DEFAULT_SERVICE;
}

/** Для /healthz самого gateway: що він узагалі знає про світ. */
export function routingTable(): { prefix: string; service: string }[] {
  return [...RULES, { prefix: '(решта)', service: DEFAULT_SERVICE }];
}
