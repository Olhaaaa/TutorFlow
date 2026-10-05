import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { dayKey, dayNumber, dowLabel, hourIn } from './time';

interface Props<T> {
  /** Сім опорних моментів тижня. */
  days: Date[];
  /** Зона глядача: і рядки, і колонки рахуються в ній. */
  tz: string;
  now: Date;
  items: T[];
  keyOf: (item: T) => number;
  startAt: (item: T) => string;
  /** На яку годину прокрутити сітку при відкритті. */
  focus?: (item: T) => boolean;
  render: (item: T) => ReactNode;
}

/**
 * Тижнева сітка: години — рядки, дні — колонки.
 *
 * Компонент нічого не знає ні про заняття, ні про ролі — лише про те, як
 * розкласти елементи за часом. Через це календар студента й кабінет викладача
 * користуються однією сіткою, і виправлення в розкладці діє на обидва.
 */
export function WeekGrid<T>({ days, tz, now, items, keyOf, startAt, focus, render }: Props<T>) {
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<number, HTMLDivElement>());
  const scrolled = useRef(false);
  const today = dayKey(now, tz);

  // Показуємо лише ті години, у яких на цьому тижні щось є: якщо викладач
  // працює вечорами, замість 24 рядків лишиться пʼять.
  const hours = useMemo(() => {
    const set = new Set<number>();
    for (const it of items) set.add(hourIn(startAt(it), tz));
    return [...set].sort((a, b) => a - b);
  }, [items, tz, startAt]);

  const byCell = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const it of items) {
      const key = `${dayKey(startAt(it), tz)}-${hourIn(startAt(it), tz)}`;
      const list = map.get(key);
      if (list) list.push(it);
      else map.set(key, [it]);
    }
    return map;
  }, [items, tz, startAt]);

  // Прокрутка до першої цікавої години: корисне видно одразу, а не після
  // ручного скролу крізь ранок.
  useEffect(() => {
    if (scrolled.current || !scroller.current || hours.length === 0) return;
    const first = focus
      ? items
          .filter(focus)
          .sort((a, b) => startAt(a).localeCompare(startAt(b)))[0]
      : undefined;
    const hour = first ? hourIn(startAt(first), tz) : hours[0]!;
    const row = rows.current.get(hour);
    if (row) scroller.current.scrollTop = Math.max(0, row.offsetTop - 40);
    scrolled.current = true;
  }, [hours, items, tz, focus, startAt]);

  return (
    <div ref={scroller} className="max-h-[calc(100dvh-13rem)] overflow-auto rounded-md border bg-card">
      <div className="grid min-w-[52rem] grid-cols-[4rem_repeat(7,minmax(6.5rem,1fr))]">
        <div className="sticky top-0 left-0 z-30 border-r border-b bg-card" />
        {days.map((d) => {
          const isToday = dayKey(d, tz) === today;
          return (
            <div
              key={d.toISOString()}
              className={cn(
                'sticky top-0 z-20 border-b bg-card px-1 py-2.5 text-center text-sm',
                isToday && 'bg-accent text-accent-foreground font-semibold',
              )}
            >
              <span className="text-muted-foreground">{dowLabel(d, tz)}</span>{' '}
              <span className="font-semibold">{dayNumber(d, tz)}</span>
            </div>
          );
        })}

        {hours.map((h) => (
          <Fragment key={h}>
            <div
              ref={(el) => {
                if (el) rows.current.set(h, el);
              }}
              className="sticky left-0 z-10 border-r border-b bg-card px-1 py-2 text-center font-mono text-sm text-muted-foreground tabular-nums"
            >
              {String(h).padStart(2, '0')}:00
            </div>
            {days.map((d) => {
              const cell = byCell.get(`${dayKey(d, tz)}-${h}`) ?? [];
              return (
                <div
                  key={`${d.toISOString()}-${h}`}
                  className={cn(
                    'min-h-[4.25rem] space-y-1 border-b p-1.5',
                    dayKey(d, tz) === today && 'bg-accent/35',
                  )}
                >
                  {cell.map((it) => (
                    <Fragment key={keyOf(it)}>{render(it)}</Fragment>
                  ))}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
