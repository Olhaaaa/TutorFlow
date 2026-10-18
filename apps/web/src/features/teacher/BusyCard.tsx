import { useCallback, useEffect, useState } from 'react';
import { CalendarX2, Copy, Link2Off, Loader2, Plus, Rss, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Session } from '@/api/client';
import type { CalendarLink, ExternalBusy } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { dateTimeLabel } from '@/features/calendar/time';

/**
 * Вікно, у якому показуємо зайнятість: місяць назад і три вперед.
 *
 * Назва саме `busyWindow`, а не `window`: друга затінила б глобальний
 * обʼєкт у всьому модулі, і React Refresh у режимі розробки не знайшов би
 * свій `window.$RefreshReg$` — сторінка лишалась би порожньою, хоча
 * продакшн-збірка працює.
 */
function busyWindow(): { from: Date; to: Date } {
  const now = Date.now();
  return { from: new Date(now - 30 * 86_400_000), to: new Date(now + 90 * 86_400_000) };
}

/**
 * `datetime-local` віддає рядок без зони — `2026-10-20T09:00`. Браузер
 * показує його як МІСЦЕВИЙ час, тому й читати треба як місцевий: `new Date`
 * над таким рядком саме це й робить. Додавати `Z` не можна — зсунуло б час на
 * зону.
 */
function toIso(local: string): string {
  return new Date(local).toISOString();
}

/**
 * Зайнятість поза розкладом і стрічка календаря.
 *
 * Обидві речі — про співіснування з календарем, у якому викладач живе
 * насправді: одна забирає години з продажу, друга віддає заняття назовні.
 */
export function BusyCard({ session }: { session: Session }) {
  const [items, setItems] = useState<ExternalBusy[] | null>(null);
  const [link, setLink] = useState<CalendarLink | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const w = busyWindow();
    try {
      const [list, calendar] = await Promise.all([
        api.teacher.busy(session.token, w.from, w.to),
        api.teacher.calendarLink(session.token),
      ]);
      setItems(list);
      setLink(calendar);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (from === '' || to === '') return;
    setBusy(true);
    try {
      await api.teacher.addBusy(session.token, {
        startAt: toIso(from),
        endAt: toIso(to),
        title: title.trim() === '' ? undefined : title.trim(),
      });
      setFrom('');
      setTo('');
      setTitle('');
      toast.success('Години забрані з продажу', {
        description: 'Вільні слоти в цьому інтервалі більше не бронюються',
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    setBusy(true);
    try {
      await api.teacher.removeBusy(session.token, id);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await api.teacher.revokeCalendarLink(session.token);
      await load();
      toast.success('Стрічку відкликано', { description: 'Стара адреса більше не працює' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const value = link?.url ?? link?.path;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Адресу скопійовано');
    } catch {
      // Буфер недоступний (не https, заборонений дозвіл) — адреса все одно на екрані.
      toast.error('Скопіюйте адресу вручну');
    }
  };

  return (
    <Card className="gap-3">
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <CalendarX2 className="size-4" aria-hidden />
          Зайнятість поза розкладом
        </CardTitle>
        <CardDescription>
          Години в цих інтервалах не бронюються. Уже записані заняття лишаються — що з ними
          робити, вирішуєте ви.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="busy-from" className="text-xs">Від</Label>
            <Input
              id="busy-from" type="datetime-local" className="h-8"
              value={from} onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="busy-to" className="text-xs">До</Label>
            <Input
              id="busy-to" type="datetime-local" className="h-8"
              value={to} onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-1">
          <Input
            className="h-8" placeholder="причина, для себе" value={title}
            onChange={(e) => setTitle(e.target.value)} aria-label="Причина"
          />
          <Button size="sm" disabled={busy || from === '' || to === ''} onClick={() => void add()}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            Додати
          </Button>
        </div>

        {items !== null && items.length > 0 && (
          <ul className="space-y-1">
            {items.map((b) => (
              <li key={b.id} className="flex items-baseline gap-2 border-b pb-1 text-sm">
                <span className="font-mono text-xs tabular-nums">
                  {dateTimeLabel(b.start_at, session.timezone)} –{' '}
                  {dateTimeLabel(b.end_at, session.timezone)}
                </span>
                <span className="truncate text-muted-foreground">{b.title ?? '—'}</span>
                <Button
                  variant="ghost" size="icon-xs" className="ml-auto"
                  disabled={busy} onClick={() => void remove(b.id)}
                  aria-label="Прибрати інтервал"
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {items !== null && items.length === 0 && (
          <p className="text-xs text-muted-foreground">Поки нічого — усі години у продажу.</p>
        )}

        <Separator />

        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Rss className="size-4" aria-hidden />
            Стрічка для свого календаря
          </p>
          <p className="text-xs text-muted-foreground">
            Підпишіться на цю адресу в Google Calendar або Apple Calendar — заняття
            з’являтимуться там самі. Адреса містить секрет: хто її має, той бачить ваш розклад.
          </p>
          {link && (
            <>
              <code className="block truncate rounded bg-muted px-2 py-1 font-mono text-[0.7rem]">
                {link.url ?? link.path}
              </code>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => void copy()}>
                  <Copy aria-hidden />
                  Скопіювати
                </Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void revoke()}>
                  <Link2Off aria-hidden />
                  Відкликати
                </Button>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
