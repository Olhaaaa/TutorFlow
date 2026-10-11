import { useCallback, useEffect, useState } from 'react';
import { BellRing, CircleCheck, Link2Off, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Session } from '@/api/client';
import type { TelegramState } from '@/api/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Канал нагадувань.
 *
 * Код показується, доки чат не привʼязаний, і зникає після привʼязки — він
 * одноразовий. Кнопка веде на бота з кодом у посиланні, тому набирати нічого
 * не треба; сам код лишається на екрані для випадку, коли застосунок відкритий
 * на компʼютері, а Telegram — у телефоні.
 */
export function TelegramCard({ session }: { session: Session }) {
  const [state, setState] = useState<TelegramState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api.telegram.state(session.token));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const unlink = async () => {
    setBusy(true);
    try {
      setState(await api.telegram.unlink(session.token));
      toast.success('Чат відвʼязано', { description: 'Нагадування більше не надсилаються' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <Skeleton className="h-28 w-full" />;

  return (
    <Card className="gap-3">
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <BellRing className="size-4" aria-hidden />
          Нагадування
        </CardTitle>
        <CardDescription>
          {state.linked
            ? 'Повідомлення про скасування заняття й зарахування коштів приходять у Telegram.'
            : 'Привʼяжіть Telegram, щоб не перевіряти застосунок вручну.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {!state.available && (
          <Alert>
            <AlertDescription>
              Канал ще не налаштований на сервері. Нагадування зберігаються, і ви побачите їх,
              коли канал підключать.
            </AlertDescription>
          </Alert>
        )}

        {state.available && state.linked && (
          <>
            <p className="flex items-center gap-1.5 text-sm font-medium text-slot-paid">
              <CircleCheck className="size-4" aria-hidden />
              чат привʼязаний
            </p>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void unlink()}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Link2Off aria-hidden />}
              Відвʼязати
            </Button>
          </>
        )}

        {state.available && !state.linked && (
          <>
            {state.deepLink && (
              <Button size="sm" className="w-full" asChild>
                <a href={state.deepLink} target="_blank" rel="noreferrer">
                  <Send aria-hidden />
                  Відкрити бота
                </a>
              </Button>
            )}
            {state.code && (
              <p className="text-xs text-muted-foreground">
                Або надішліть боту код{' '}
                <span className="font-mono text-sm font-medium text-foreground tracking-wider">
                  {state.code}
                </span>
                {state.botUsername && (
                  <>
                    {' '}— бот{' '}
                    <span className="font-mono">@{state.botUsername}</span>
                  </>
                )}
                . Код одноразовий.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
