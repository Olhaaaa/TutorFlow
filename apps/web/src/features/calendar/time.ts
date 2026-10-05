/**
 * Робота з часом на клієнті.
 *
 * Сервер завжди віддає UTC, а показуємо ми в зоні СТУДЕНТА — її віддає
 * /auth/login разом із токеном. Зона браузера тут навмисно не використовується:
 * студент у відрядженні має бачити ту саму сітку, що й удома, інакше «вівторок
 * о 16:00» означає різні заняття на ноутбуці й на телефоні.
 *
 * Через це вся розкладка рахується не через getHours(), а через Intl із явним
 * timeZone: лише він знає про переходи на зимовий час у чужій зоні.
 */

const DAY_MS = 86_400_000;

/** Intl.DateTimeFormat дорогий у створенні, а потрібен на кожну клітинку сітки. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opts);
    formatters.set(key, f);
  }
  return f;
}

function part(d: Date, tz: string, type: Intl.DateTimeFormatPartTypes): string {
  const parts = formatter('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(d);
  return parts.find((p) => p.type === type)?.value ?? '';
}

/** Календарний день моменту в зоні студента, у вигляді `2026-10-07`. */
export function dayKey(d: Date | string, tz: string): string {
  const at = typeof d === 'string' ? new Date(d) : d;
  return `${part(at, tz, 'year')}-${part(at, tz, 'month')}-${part(at, tz, 'day')}`;
}

/** Година доби в зоні студента, 0–23. Саме вона задає рядок сітки. */
export function hourIn(d: Date | string, tz: string): number {
  const at = typeof d === 'string' ? new Date(d) : d;
  return Number(part(at, tz, 'hour')) % 24;
}

const EN_DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** 0 — понеділок. Тиждень починається з понеділка, бо так його читають тут. */
function weekdayIndex(d: Date, tz: string): number {
  const i = EN_DOW.indexOf(part(d, tz, 'weekday'));
  return i < 0 ? 0 : i;
}

/**
 * Момент, що гарантовано лежить усередині заданого календарного дня зони.
 * Опівдень, а не північ: від полудня можна додавати добу, не боячись, що
 * перехід на зимовий час перекине точку в сусідній день.
 */
function noonOf(key: string, tz: string): Date {
  let t = new Date(`${key}T12:00:00Z`);
  // Зони з великим зсувом (+13, −11) можуть зсунути полудень UTC на сусідній
  // день — двох поправок вистачає для будь-якої реальної зони.
  for (let i = 0; i < 2; i += 1) {
    const got = dayKey(t, tz);
    if (got === key) break;
    t = new Date(t.getTime() + (got < key ? DAY_MS : -DAY_MS));
  }
  return t;
}

/** Понеділок тижня, у який потрапляє момент, як «полудень того понеділка». */
export function weekAnchor(d: Date, tz: string): Date {
  const noon = noonOf(dayKey(d, tz), tz);
  return new Date(noon.getTime() - weekdayIndex(noon, tz) * DAY_MS);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** Сім опорних моментів тижня — по одному на день. */
export function weekDays(anchor: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
}

const UA_DOW = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];

export function dowLabel(d: Date, tz: string): string {
  return UA_DOW[weekdayIndex(d, tz)]!;
}

export function dayNumber(d: Date, tz: string): string {
  return String(Number(part(d, tz, 'day')));
}

export function rangeLabel(anchor: Date, tz: string): string {
  const from = anchor;
  const to = addDays(anchor, 6);
  const fmt = (x: Date, withMonth: boolean) =>
    formatter('uk-UA', {
      timeZone: tz,
      day: 'numeric',
      ...(withMonth ? { month: 'long' } : {}),
    }).format(x);
  const sameMonth = part(from, tz, 'month') === part(to, tz, 'month');
  return `${fmt(from, !sameMonth)} – ${fmt(to, true)}`;
}

export function hhmm(d: Date | string, tz: string): string {
  const at = typeof d === 'string' ? new Date(d) : d;
  return formatter('uk-UA', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

export function dateTimeLabel(iso: string, tz: string): string {
  return formatter('uk-UA', {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** `GMT+3` — щоб підпис зони читався без знання географії. */
export function zoneOffset(tz: string): string {
  const parts = formatter('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(
    new Date(),
  );
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/** Чи момент уже минув. Бронювати минуле не можна — сервер теж це відхилить. */
export function isPast(iso: string, now: Date = new Date()): boolean {
  return new Date(iso).getTime() <= now.getTime();
}

export function money(minor: number): string {
  return `${Math.trunc(minor / 100)} ₴`;
}
