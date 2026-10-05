import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck,
  CalendarOff,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleSlash,
  Globe,
  History,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, type Session } from '@/api/client';
import type { SlotStatus, TeacherSlotView } from '@/api/types';
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
import { slotBox } from '@/features/calendar/slot-variants';
import { WeekGrid } from '@/features/calendar/WeekGrid';
import {
  addDays,
  dateTimeLabel,
  dayKey,
  hhmm,
  money,
  rangeLabel,
  weekAnchor,
  weekDays,
  zoneOffset,
} from '@/features/calendar/time';
import { cn } from '@/lib/utils';

/**
 * Статус заняття очима викладача. Кольори й подача — ті самі, що в студента,
 * бо мова станів у застосунку одна; відрізняється лише підпис: викладачу
 * важливо не «моє/чуже», а хто саме записаний.
 */
const STATUS: Record<
  SlotStatus,
  { label: string; variant: 'free' | 'unpaid' | 'paid' | 'busy' | 'past' | 'late'; Icon: typeof CalendarPlus }
> = {
  free: { label: 'вільно', variant: 'free', Icon: CalendarPlus },
  pre_booked: { label: 'не оплачено', variant: 'unpaid', Icon: CircleAlert },
  booked: { label: 'оплачено', variant: 'paid', Icon: CalendarCheck },
  done: { label: 'проведено', variant: 'past', Icon: History },
  cancelled_late: { label: 'скасовано пізно', variant: 'late', Icon: CircleSlash },
};

function TeacherSlot({ slot, tz }: { slot: TeacherSlotView; tz: string }) {
  const s = STATUS[slot.status];
  const { Icon } = s;

  return (
    <div
      className={cn(slotBox({ variant: s.variant, shape: 'cell' }))}
      title={slot.payBy ? `тримається до ${dateTimeLabel(slot.payBy, tz)}` : s.label}
    >
      <div className="flex items-center gap-1">
        <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
        <span className="font-mono text-sm font-medium tabular-nums">
          {hhmm(slot.startAt, tz)}
        </span>
      </div>
      <span className="line-clamp-2 text-xs leading-tight">
        {slot.student ? slot.student.name : s.label}
      </span>
      {slot.student && (
        <span className="text-[0.7rem] leading-tight opacity-80">{s.label}</span>
      )}
    </div>
  );
}

export function TeacherSchedule({ session }: { session: Session }) {
  const tz = session.timezone;
  const [cursor, setCursor] = useState(() => new Date());
  const [now, setNow] = useState(() => new Date());
  const [slots, setSlots] = useState<TeacherSlotView[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const anchor = useMemo(() => weekAnchor(cursor, tz), [cursor, tz]);
  const days = useMemo(() => weekDays(anchor), [anchor]);

  const load = useCallback(async () => {
    setLoading(true);
    setNow(new Date());
    try {
      setSlots(await api.teacher.slots(session.token, addDays(anchor, -1), addDays(anchor, 8)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }, [session.token, anchor]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const keys = new Set(days.map((d) => dayKey(d, tz)));
    return slots.filter((s) => keys.has(dayKey(s.startAt, tz)));
  }, [slots, days, tz]);

  const taken = visible.filter((s) => s.status !== 'free');
  const earned = visible
    .filter((s) => s.status === 'booked' || s.status === 'done' || s.status === 'cancelled_late')
    .reduce((sum, s) => sum + s.priceMinor, 0);

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await api.teacher.generate(session.token, 4);
      toast.success(
        r.created > 0 ? `Створено занять: ${r.created}` : 'Нових занять не додалось',
        { description: 'Шаблон розгорнуто на чотири тижні вперед' },
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-xl">{rangeLabel(anchor, tz)}</CardTitle>
        <CardDescription>
          <Globe className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
          ваша зона: {tz} ({zoneOffset(tz)})
          {!loading && (
            <>
              <Badge variant="secondary" className="ml-2 align-[1px]">
                зайнятих годин: {taken.length}
              </Badge>
              <Badge variant="secondary" className="ml-2 align-[1px]">
                оплачено на {money(earned)}
              </Badge>
            </>
          )}
        </CardDescription>
        <CardAction className="flex flex-wrap items-center gap-1">
          <Button variant="outline" size="sm" disabled={generating} onClick={generate}>
            {generating ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            згенерувати слоти
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setCursor((c) => addDays(c, -7))}
            aria-label="Попередній тиждень"
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
            сьогодні
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setCursor((c) => addDays(c, 7))}
            aria-label="Наступний тиждень"
          >
            <ChevronRight aria-hidden />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent>
        {loading && (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-8 w-full" />
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}

        {!loading && visible.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-10 text-center">
            <CalendarOff className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">На цьому тижні занять немає</p>
            <p className="text-sm text-muted-foreground">
              Додайте години у вкладці «Доступність» і розгорніть шаблон у слоти.
            </p>
          </div>
        )}

        {!loading && visible.length > 0 && (
          <WeekGrid
            days={days}
            tz={tz}
            now={now}
            items={visible}
            keyOf={(s) => s.id}
            startAt={(s) => s.startAt}
            focus={(s) => s.status !== 'free'}
            render={(s) => <TeacherSlot slot={s} tz={tz} />}
          />
        )}
      </CardContent>
    </Card>
  );
}
