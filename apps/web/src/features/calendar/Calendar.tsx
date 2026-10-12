import { useMemo, useState } from 'react';
import { CalendarOff, ChevronLeft, ChevronRight, Globe } from 'lucide-react';
import type { SlotView } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Slot } from './Slot';
import { WeekGrid } from './WeekGrid';
import { displayOf } from './slot-state';
import { useMediaQuery, WIDE } from './use-media-query';
import { dayKey, dayNumber, dowLabel, rangeLabel, weekDays, zoneOffset } from './time';

interface Props {
  /** Полудень понеділка показаного тижня — у зоні студента. */
  anchor: Date;
  tz: string;
  /** Момент, відносно якого рахується «сьогодні» й «минуло». */
  now: Date;
  slots: SlotView[];
  loading: boolean;
  actingId: number | null;
  onAct: (slot: SlotView) => void;
  /** Заняття, яке зараз переносять. null — звичайний режим. */
  movingId?: number | null;
  onMove?: (slot: SlotView) => void;
  onWeekShift: (delta: number) => void;
  onToday: () => void;
}

export function Calendar(props: Props) {
  const wide = useMediaQuery(WIDE);
  const days = useMemo(() => weekDays(props.anchor), [props.anchor]);
  const free = props.slots.filter((s) => displayOf(s, props.now).action === 'book').length;

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-xl">{rangeLabel(props.anchor, props.tz)}</CardTitle>
        <CardDescription>
          {/* іконка всередині тексту, а не окремим flex-елементом: на вузькому
              екрані інакше вона лишається сама на рядку */}
          <Globe className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
          час у вашій зоні: {props.tz} ({zoneOffset(props.tz)})
          {!props.loading && (
            <Badge variant="secondary" className="ml-2 align-[1px]">
              {free > 0 ? `вільних занять: ${free}` : 'вільних занять немає'}
            </Badge>
          )}
        </CardDescription>
        <CardAction className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => props.onWeekShift(-1)}
            aria-label="Попередній тиждень"
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="outline" size="sm" onClick={props.onToday}>
            сьогодні
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => props.onWeekShift(1)}
            aria-label="Наступний тиждень"
          >
            <ChevronRight aria-hidden />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent>
        {props.loading && <Loading />}

        {!props.loading && props.slots.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-10 text-center">
            <CalendarOff className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">На цьому тижні занять немає</p>
            <p className="text-sm text-muted-foreground">
              Спробуйте наступний тиждень — розклад відкритий на чотири тижні вперед.
            </p>
            <Button variant="outline" size="sm" onClick={() => props.onWeekShift(1)}>
              Наступний тиждень
              <ChevronRight aria-hidden />
            </Button>
          </div>
        )}

        {!props.loading &&
          props.slots.length > 0 &&
          (wide ? <WeekGridView days={days} {...props} /> : <DayList days={days} {...props} />)}
      </CardContent>
    </Card>
  );
}

function Loading() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Завантаження розкладу">
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

/* ---------- широкий екран: сітка тижня ---------- */

function WeekGridView({
  days, slots, tz, now, actingId, onAct, movingId, onMove,
}: Props & { days: Date[] }) {
  return (
    <WeekGrid
      days={days}
      tz={tz}
      now={now}
      items={slots}
      keyOf={(s) => s.id}
      startAt={(s) => s.startAt}
      focus={(s) => displayOf(s, now).action === 'book'}
      render={(s) => (
        <Slot
          slot={s}
          tz={tz}
          now={now}
          acting={actingId === s.id}
          onAct={onAct}
          moving={movingId != null}
          isSource={movingId === s.id}
          onMove={onMove}
        />
      )}
    />
  );
}

/* ---------- вузький екран: список одного дня ---------- */

function DayList({
  days, slots, tz, now, actingId, onAct, movingId, onMove,
}: Props & { days: Date[] }) {
  const today = dayKey(now, tz);
  const todayIndex = days.findIndex((d) => dayKey(d, tz) === today);
  const [picked, setPicked] = useState(() => dayKey(days[Math.max(0, todayIndex)]!, tz));

  const ofDay = (key: string) =>
    slots
      .filter((s) => dayKey(s.startAt, tz) === key)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));

  return (
    <Tabs value={picked} onValueChange={setPicked}>
      <TabsList className="w-full justify-between">
        {days.map((d) => {
          const key = dayKey(d, tz);
          const freeCount = ofDay(key).filter((s) => displayOf(s, now).action === 'book').length;
          return (
            <TabsTrigger key={key} value={key} className="min-w-0 flex-1 flex-col gap-0 px-1 py-1">
              <span className="text-[0.7rem] text-muted-foreground">{dowLabel(d, tz)}</span>
              <span className="text-sm font-medium">{dayNumber(d, tz)}</span>
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  freeCount > 0 ? 'bg-primary' : 'bg-transparent',
                )}
                aria-label={freeCount > 0 ? `вільних: ${freeCount}` : undefined}
              />
            </TabsTrigger>
          );
        })}
      </TabsList>

      {days.map((d) => {
        const key = dayKey(d, tz);
        const list = ofDay(key);
        return (
          <TabsContent key={key} value={key} className="space-y-2">
            {list.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                цього дня занять немає
              </p>
            ) : (
              list.map((s) => (
                <Slot
                  key={s.id}
                  slot={s}
                  tz={tz}
                  now={now}
                  shape="row"
                  acting={actingId === s.id}
                  onAct={onAct}
                  moving={movingId != null}
                  isSource={movingId === s.id}
                  onMove={onMove}
                />
              ))
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
