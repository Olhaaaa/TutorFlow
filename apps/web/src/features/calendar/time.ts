/**
 * Робота з часом на клієнті. Сервер завжди віддає UTC, а показуємо ми в зоні
 * глядача — зону беремо з браузера, не питаючи.
 */
export const viewerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const DAY_MS = 86_400_000;

/** Понеділок тижня, у який потрапляє дата, за локальним часом глядача. */
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const shift = (x.getDay() + 6) % 7; // 0 — понеділок
  x.setDate(x.getDate() - shift);
  return x;
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export function weekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const DOW = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];

export function dayLabel(d: Date): string {
  return `${DOW[(d.getDay() + 6) % 7]} ${d.getDate()}`;
}

export function monthLabel(d: Date): string {
  return d.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
}

export function hhmm(d: Date): string {
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

export function dateTimeLabel(iso: string): string {
  return new Date(iso).toLocaleString('uk-UA', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function money(minor: number): string {
  return `${Math.trunc(minor / 100)} ₴`;
}
