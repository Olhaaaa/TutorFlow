/**
 * Серіалізація календарної стрічки, RFC 5545.
 *
 * Чистий модуль: на вхід — заняття, на вихід — рядок. Жодної бази, жодного
 * HTTP, тому формат можна перевірити тестом, а не оком у Google Calendar через
 * дві години після того, як він наступного разу зайде по стрічку.
 *
 * Формат оманливо простий. Три речі в ньому ламають інтеграцію тихо:
 *
 *   1. Переноси рядків мусять бути CRLF. З `\n` календарі або не читають
 *      файл, або читають половину.
 *   2. Рядок довший за 75 байт мусить бути «складений»: продовження починається
 *      з ПРОБІЛУ. Український текст тут важливий окремо — складати треба по
 *      байтах UTF-8, а не по символах, інакше складка розрубує символ навпіл.
 *   3. `UID` мусить бути стабільним між викликами. Якщо він змінюється, кожна
 *      синхронізація створює дублікати замість оновлення наявних подій.
 */

/** Одне заняття у стрічці. Час завжди UTC — у стрічці він із суфіксом Z. */
export interface CalendarEvent {
  /** Стабільний між викликами: з нього будується UID. */
  slotId: number;
  startAt: Date;
  endAt: Date;
  summary: string;
  description?: string;
  /** Скасоване заняття не зникає, а стає CANCELLED: так календарі прибирають його самі. */
  cancelled?: boolean;
}

/** Домен у UID. Значення довільне, але мусить бути стабільним. */
const UID_DOMAIN = 'tutorflow';

/**
 * `20261012T140000Z`. Секунди обовʼязкові, дефіси й двокрапки — зайві: формат
 * календаря базовий, не розширений ISO.
 */
function stamp(at: Date): string {
  return `${at.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/**
 * Екранування тексту: кома, крапка з комою й бекслеш мають у форматі власне
 * значення, а перенос рядка пишеться як `\\n`.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Скласти рядок до 75 байт. Рахуються БАЙТИ: у `Їжак` чотири символи й сім
 * байтів, і складка по символах дала б рядок, довший за дозволене, а складка
 * посеред байтової послідовності — зламаний символ.
 */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let start = 0;
  // Перший рядок — 75 байт, наступні — 74, бо до них додається пробіл.
  let limit = 75;

  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Не розрубати символ: продовження UTF-8 має старші біти 10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74;
  }

  return parts.join('\r\n ');
}

/**
 * Стрічка календаря.
 *
 * @param events заняття; порядок зберігається
 * @param name назва календаря, яку покаже програма
 * @param now момент генерації — параметром, а не `new Date()` всередині,
 *   інакше функцію неможливо перевірити детерміновано
 */
export function buildCalendar(
  events: readonly CalendarEvent[],
  name: string,
  now: Date,
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${UID_DOMAIN}//uk//EN`,
    'CALSCALE:GREGORIAN',
    // Підказка календарю, як часто заходити. Рекомендація, не гарантія:
    // Google однаково ходить раз на кілька годин.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];

  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:slot-${event.slotId}@${UID_DOMAIN}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(event.startAt)}`,
      `DTEND:${stamp(event.endAt)}`,
      `SUMMARY:${escapeText(event.summary)}`,
    );
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    lines.push(`STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  // CRLF у кінці теж обовʼязковий.
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
