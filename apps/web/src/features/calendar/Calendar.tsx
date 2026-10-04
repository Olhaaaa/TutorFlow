import { useEffect, useMemo, useRef, useState } from 'react';
import type { SlotView } from '../../api/types.js';
import { Slot } from './Slot.js';
import { useMediaQuery, WIDE } from './use-media-query.js';
import {
  dayLabel, hhmm, monthLabel, sameLocalDay, viewerTimeZone, weekDays,
} from './time.js';

interface Props {
  weekStart: Date;
  slots: SlotView[];
  loading: boolean;
  actingId: number | null;
  onAct: (slot: SlotView) => void;
  onWeekShift: (delta: number) => void;
}

export function Calendar(props: Props) {
  const wide = useMediaQuery(WIDE);
  const days = useMemo(() => weekDays(props.weekStart), [props.weekStart]);

  return (
    <section className="cal">
      <header className="cal__bar">
        <button onClick={() => props.onWeekShift(-1)} aria-label="Попередній тиждень">←</button>
        <div className="cal__title">
          <strong>{monthLabel(props.weekStart)}</strong>
          <span className="cal__tz">час у зоні {viewerTimeZone}</span>
        </div>
        <button onClick={() => props.onWeekShift(1)} aria-label="Наступний тиждень">→</button>
      </header>

      {props.loading && <p className="cal__msg">завантаження…</p>}
      {!props.loading && props.slots.length === 0 && (
        <p className="cal__msg">на цьому тижні занять немає</p>
      )}

      {!props.loading && props.slots.length > 0 && (
        wide
          ? <WeekGrid days={days} {...props} />
          : <DayList days={days} {...props} />
      )}
    </section>
  );
}

/* ---------- широкий екран: сітка тижня ---------- */

function WeekGrid({ days, slots, actingId, onAct }: Props & { days: Date[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  // Показуємо лише ті години, у яких на цьому тижні є хоч один слот.
  // Якщо викладач працює вечорами, замість 24 рядків буде пʼять.
  const hours = useMemo(() => {
    const set = new Set<number>();
    for (const s of slots) set.add(new Date(s.startAt).getHours());
    return [...set].sort((a, b) => a - b);
  }, [slots]);

  const byCell = useMemo(() => {
    const map = new Map<string, SlotView[]>();
    for (const s of slots) {
      const d = new Date(s.startAt);
      const key = `${d.getDay()}-${d.getHours()}`;
      (map.get(key) ?? map.set(key, []).get(key)!).push(s);
    }
    return map;
  }, [slots]);

  // Прокрутка до першої години з вільним слотом: користувач бачить корисне одразу.
  useEffect(() => {
    if (scrolled.current || !scroller.current || hours.length === 0) return;
    const firstFree = slots
      .filter((s) => s.state === 'free')
      .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
    const hour = firstFree ? new Date(firstFree.startAt).getHours() : hours[0]!;
    const row = Math.max(0, hours.indexOf(hour));
    scroller.current.scrollTop = row * 72;
    scrolled.current = true;
  }, [hours, slots]);

  return (
    <div className="cal__scroll" ref={scroller}>
      <div className="grid">
        <div className="grid__corner" />
        {days.map((d) => (
          <div key={d.toISOString()} className="grid__day">{dayLabel(d)}</div>
        ))}

        {hours.map((h) => (
          <div className="grid__row" key={h} style={{ display: 'contents' }}>
            <div className="grid__hour">{String(h).padStart(2, '0')}:00</div>
            {days.map((d) => {
              const cell = byCell.get(`${d.getDay()}-${h}`) ?? [];
              const mine = cell.filter((s) => sameLocalDay(new Date(s.startAt), d));
              return (
                <div className="grid__cell" key={`${d.toISOString()}-${h}`}>
                  {mine.map((s) => (
                    <Slot key={s.id} slot={s} busy={actingId === s.id} onAct={onAct} />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- вузький екран: список одного дня ---------- */

function DayList({ days, slots, actingId, onAct }: Props & { days: Date[] }) {
  const [picked, setPicked] = useState(0);
  const day = days[picked]!;
  const ofDay = slots
    .filter((s) => sameLocalDay(new Date(s.startAt), day))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  return (
    <>
      <div className="picker" role="tablist" aria-label="День тижня">
        {days.map((d, i) => {
          const count = slots.filter((s) => sameLocalDay(new Date(s.startAt), d)).length;
          return (
            <button
              key={d.toISOString()}
              role="tab"
              aria-selected={i === picked}
              className={`picker__day ${i === picked ? 'is-on' : ''}`}
              onClick={() => setPicked(i)}
            >
              {dayLabel(d)}
              {count > 0 && <span className="picker__dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      {ofDay.length === 0 && <p className="cal__msg">цього дня занять немає</p>}

      <ul className="daylist">
        {ofDay.map((s) => (
          <li key={s.id}>
            <Slot slot={s} wide busy={actingId === s.id} onAct={onAct} />
          </li>
        ))}
      </ul>

      <p className="cal__hint">
        {ofDay.length > 0 && `${hhmm(new Date(ofDay[0]!.startAt))} — ${hhmm(new Date(ofDay[ofDay.length - 1]!.endAt))}`}
      </p>
    </>
  );
}
