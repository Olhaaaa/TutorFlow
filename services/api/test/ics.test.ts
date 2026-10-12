/**
 * Формат календарної стрічки. Бази не потребує — це серіалізація.
 *
 * Перевіряється саме те, через що інтеграція з календарями ламається тихо:
 * CRLF, складання довгих рядків по БАЙТАХ, стабільний UID і екранування.
 */
import { describe, expect, it } from 'vitest';
import { buildCalendar, foldLine, type CalendarEvent } from '../src/scheduling/ics.js';

const NOW = new Date('2026-10-12T09:00:00Z');

const lesson: CalendarEvent = {
  slotId: 42,
  startAt: new Date('2026-10-13T11:00:00Z'),
  endAt: new Date('2026-10-13T12:00:00Z'),
  summary: 'Заняття: Богдан',
};

const feed = (events: CalendarEvent[] = [lesson]) => buildCalendar(events, 'Tutorflow', NOW);

describe('кістяк стрічки', () => {
  it('починається й закінчується як VCALENDAR', () => {
    const lines = feed().split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines.at(-2)).toBe('END:VCALENDAR');
  });

  it('переноси рядків — CRLF, і файл ними ж закінчується', () => {
    const text = feed();
    expect(text.endsWith('\r\n')).toBe(true);
    // жодного самотнього \n без \r перед ним
    expect(/[^\r]\n/.test(text)).toBe(false);
  });

  it('час у базовому форматі з Z, без дефісів і двокрапок', () => {
    expect(feed()).toContain('DTSTART:20261013T110000Z');
    expect(feed()).toContain('DTEND:20261013T120000Z');
    expect(feed()).toContain('DTSTAMP:20261012T090000Z');
  });
});

describe('UID', () => {
  it('будується зі слота, тому стабільний між викликами', () => {
    const a = feed();
    const b = buildCalendar([lesson], 'Tutorflow', new Date('2026-11-01T00:00:00Z'));
    expect(a).toContain('UID:slot-42@tutorflow');
    // змінився лише момент генерації, UID — ні: інакше кожна синхронізація
    // створювала б дублікати замість оновлення
    expect(b).toContain('UID:slot-42@tutorflow');
  });

  it('різні заняття — різні UID', () => {
    const text = feed([lesson, { ...lesson, slotId: 43 }]);
    expect(text).toContain('UID:slot-42@tutorflow');
    expect(text).toContain('UID:slot-43@tutorflow');
  });
});

describe('статус', () => {
  it('звичайне заняття підтверджене', () => {
    expect(feed()).toContain('STATUS:CONFIRMED');
  });

  it('скасоване пізно віддається як CANCELLED, а не ховається', () => {
    expect(feed([{ ...lesson, cancelled: true }])).toContain('STATUS:CANCELLED');
  });
});

describe('екранування', () => {
  it('кома, крапка з комою й бекслеш мають власне значення у форматі', () => {
    const text = feed([{ ...lesson, summary: 'Заняття: Богдан, 1;2 \\ 3' }]);
    expect(text).toContain('SUMMARY:Заняття: Богдан\\, 1\\;2 \\\\ 3');
  });

  it('перенос рядка в описі стає \\n, а не рве стрічку', () => {
    const text = feed([{ ...lesson, description: 'перший\nдругий' }]);
    expect(text).toContain('DESCRIPTION:перший\\nдругий');
    expect(text.split('\r\n').filter((l) => l.startsWith('DESCRIPTION'))).toHaveLength(1);
  });
});

describe('складання довгих рядків', () => {
  it('короткий рядок не чіпається', () => {
    expect(foldLine('SUMMARY:коротко')).toBe('SUMMARY:коротко');
  });

  it('довгий складається, і продовження починається з пробілу', () => {
    const folded = foldLine(`SUMMARY:${'x'.repeat(200)}`);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    expect(Buffer.from(parts[0]!, 'utf8').length).toBe(75);
    for (const part of parts.slice(1)) expect(part.startsWith(' ')).toBe(true);
  });

  it('український текст не розрубується посеред символа', () => {
    const folded = foldLine(`SUMMARY:${'Їжак'.repeat(40)}`);
    // якби складка різала байти, тут були б символи заміни
    expect(folded).not.toContain('�');
    const restored = folded.split('\r\n').map((p, i) => (i === 0 ? p : p.slice(1))).join('');
    expect(restored).toBe(`SUMMARY:${'Їжак'.repeat(40)}`);
  });

  it('кожен рядок стрічки вкладається у 75 байт', () => {
    const text = feed([{ ...lesson, summary: 'Заняття: '.repeat(20) }]);
    for (const line of text.split('\r\n')) {
      expect(Buffer.from(line, 'utf8').length).toBeLessThanOrEqual(75);
    }
  });
});
