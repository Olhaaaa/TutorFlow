import { useCallback, useEffect, useState } from 'react';
import { Clock, Info, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Session } from '@/api/client';
import type { AvailabilityRule } from '@/api/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { money } from '@/features/calendar/time';
import { TimezoneCard } from '@/features/profile/TimezoneCard';
import { EnrollmentsCard } from './EnrollmentsCard';

/** 0 — неділя, як у PostgreSQL extract(dow). Той самий порядок, що в API. */
const DOW = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота'];
/** Загальноприйняті скорочення: обрізати повну назву не можна — вийде «пʼ» і «се». */
const DOW_SHORT = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function AvailabilityPanel({
  session,
  onTimezoneChange,
}: {
  session: Session;
  onTimezoneChange: (timezone: string) => void;
}) {
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [weekday, setWeekday] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRules(await api.teacher.availability(session.token));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSaving(true);
    try {
      await api.teacher.setAvailability(session.token, {
        weekday,
        startTime: String(form.get('startTime') ?? ''),
        durationMin: Number(form.get('durationMin') ?? 60),
        priceMinor: Math.round(Number(form.get('price') ?? 0) * 100),
      });
      toast.success('Годину додано в шаблон', {
        description: 'Щоб вона перетворилась на заняття, згенеруйте слоти у вкладці «Розклад»',
      });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Тижневий шаблон</CardTitle>
          <CardDescription>
            Години вказані у вашому часі ({session.timezone}). Слоти розгортаються з шаблону
            через <code className="font-mono">AT TIME ZONE</code>, тому перехід на зимовий час не
            зсуває розклад.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)
          ) : rules.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
              шаблон порожній — додайте першу годину
            </p>
          ) : (
            ORDER.map((d) => {
              const ofDay = rules.filter((r) => r.weekday === d);
              if (ofDay.length === 0) return null;
              return (
                <div key={d} className="flex flex-wrap items-baseline gap-2 border-b pb-3">
                  <span className="w-28 shrink-0 text-sm font-medium">{DOW[d]}</span>
                  {ofDay.map((r) => (
                    <Badge key={r.id} variant="outline" className="font-mono tabular-nums">
                      {r.start_time.slice(0, 5)} · {money(r.price_minor)}
                    </Badge>
                  ))}
                  <span className="ml-auto text-xs text-muted-foreground">
                    годин: {ofDay.length}
                  </span>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <EnrollmentsCard session={session} />
      </div>

      <div className="space-y-4">
        <TimezoneCard session={session} onChange={onTimezoneChange} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Додати годину</CardTitle>
            <CardDescription>Одна година тижневого шаблону — одне заняття на тиждень.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-3" onSubmit={add}>
              <div className="space-y-1.5">
                <Label>День тижня</Label>
                <div className="flex flex-wrap gap-1">
                  {ORDER.map((d) => (
                    <Button
                      key={d}
                      type="button"
                      size="sm"
                      variant={weekday === d ? 'default' : 'outline'}
                      onClick={() => setWeekday(d)}
                    >
                      {DOW_SHORT[d]}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="av-time">Початок</Label>
                <Input id="av-time" name="startTime" type="time" defaultValue="18:00" required />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="av-dur">Хвилин</Label>
                  <Input
                    id="av-dur"
                    name="durationMin"
                    type="number"
                    min={15}
                    max={480}
                    step={15}
                    defaultValue={60}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="av-price">Ціна, ₴</Label>
                  <Input
                    id="av-price"
                    name="price"
                    type="number"
                    min={0}
                    step={50}
                    defaultValue={500}
                    required
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
                Додати в шаблон
              </Button>
            </form>

            <Alert>
              <Info aria-hidden />
              <AlertDescription>
                Прибрати годину з шаблону поки не можна — у API немає такого маршруту. Повторне
                додавання тієї самої години перезаписує ціну й тривалість.
              </AlertDescription>
            </Alert>

            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Нова година не створює занять сама: натисніть «згенерувати слоти» у вкладці «Розклад».
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
