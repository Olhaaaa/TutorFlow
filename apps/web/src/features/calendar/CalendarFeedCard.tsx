import { useCallback, useEffect, useState } from 'react';
import { Copy, Link2Off, Loader2, Rss } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Session } from '@/api/client';
import type { CalendarLink } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Стрічка `.ics` студента.
 *
 * Та сама ідея, що й у викладача в «Зайнятості поза розкладом», але власна
 * адреса й власний секрет: студент бачить у ній лише свої заняття й відкликає
 * її, нікого більше не зачіпаючи.
 *
 * Адреса запитується одразу при відкритті кабінету, а не після натискання:
 * GET її ж і створює, і ховати це за кнопкою означало б пояснювати людині
 * різницю між «немає» і «ще не випущена».
 */
export function CalendarFeedCard({ session }: { session: Session }) {
  const [link, setLink] = useState<CalendarLink | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLink(await api.calendarLink(session.token));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async () => {
    setBusy(true);
    try {
      await api.revokeCalendarLink(session.token);
      setLink(null);
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
          <Rss className="size-4" aria-hidden />
          Заняття у вашому календарі
        </CardTitle>
        <CardDescription>
          Підпишіться на цю адресу в Google Calendar чи Apple Calendar — заняття зʼявлятимуться
          там самі, разом із перенесеннями й скасуваннями. Адреса містить секрет: хто її має, той
          бачить ваш розклад.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-2">
        {link === null ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Готуємо адресу…
          </p>
        ) : (
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
            <p className="text-xs text-muted-foreground">
              Календарі заходять по стрічку раз на кілька годин — свіжу зміну видно тут, у
              застосунку, одразу, а в календарі трохи згодом.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
