import { useCallback, useEffect, useState } from 'react';
import {
  CircleAlert,
  CircleCheck,
  CreditCard,
  Link2Off,
  Loader2,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, type Session } from '@/api/client';
import type { PaymentConnection } from '@/api/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { dateTimeLabel } from '@/features/calendar/time';

/**
 * Куди провайдер віддасть результат оплати.
 *
 * Це стан РОЗГОРТАННЯ, а не рахунку, але показується він тут: інакше про
 * проблему першим дізнається студент — у вигляді помилки при спробі
 * заплатити. Три випадки розрізняються навмисно, бо лікуються по-різному.
 */
function Delivery({ state }: { state: PaymentConnection }) {
  if (!state.publicBaseUrl) {
    return (
      <Alert>
        <TriangleAlert aria-hidden />
        <AlertTitle>Не задано адресу застосунку</AlertTitle>
        <AlertDescription>
          <p>
            Рахунок створиться й оплатити його можна, але зі сторінки банку студента нікуди не
            повернуть, і кошти зарахуються лише коли він сам відкриє застосунок.
          </p>
          <p>
            Задайте <code className="font-mono">PUBLIC_BASE_URL</code> у{' '}
            <code className="font-mono">.env</code> — у розробці це{' '}
            <code className="font-mono">http://localhost:5173</code>, у хмарі адреса розгортання.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  if (!state.webhookUrl) {
    return (
      <Alert>
        <CircleAlert aria-hidden />
        <AlertTitle>Вебхук не надсилається</AlertTitle>
        <AlertDescription>
          <p>
            Адреса <code className="font-mono">{state.publicBaseUrl}</code> не видна з інтернету,
            тому просити провайдера про вебхук немає сенсу — він до неї не дійде.
          </p>
          <p>
            Оплата при цьому працює: статус рахунку добирається опитуванням, коли студент
            повертається зі сторінки банку. Для справжньої доставки потрібен тунель або хмарна
            адреса на https.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <CircleCheck aria-hidden />
      <AlertTitle>Результат приходить вебхуком</AlertTitle>
      <AlertDescription>
        <code className="font-mono break-all">{state.webhookUrl}</code>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Підключення власного рахунку викладача.
 *
 * Токен сюди ніколи не повертається — ні при завантаженні, ні після
 * збереження. Якщо викладач його загубив, він випускає новий у провайдера,
 * а не підглядає старий тут.
 */
export function PaymentsPanel({ session }: { session: Session }) {
  const [state, setState] = useState<PaymentConnection | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api.teacher.paymentConnection(session.token));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async () => {
    setBusy(true);
    try {
      const next = await api.teacher.connectPayments(session.token, token.trim());
      setState(next);
      setToken('');
      toast.success('Рахунок підключено', {
        description: 'Оплати студентів тепер надходять на нього',
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      setState(await api.teacher.disconnectPayments(session.token));
      toast.success('Рахунок відключено');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <div className="max-w-2xl space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="size-5" aria-hidden />
            Приймання оплати
          </CardTitle>
          <CardDescription>
            Студенти платять карткою напряму на ваш рахунок — платформа кошти не тримає й не
            перераховує.
          </CardDescription>
          <CardAction>
            {state.connected ? (
              <Badge className="bg-slot-paid text-slot-paid-fg">
                <CircleCheck aria-hidden />
                підключено
              </Badge>
            ) : (
              <Badge variant="outline">не підключено</Badge>
            )}
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-4">
          {!state.canConnect && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertTitle>Підключення недоступне</AlertTitle>
              <AlertDescription>
                На сервері не задано ключ шифрування платіжних токенів
                (<code className="font-mono">PAYMENT_TOKEN_KEY</code>). Без нього зберігати токен
                не можна — зверніться до того, хто адмініструє розгортання.
              </AlertDescription>
            </Alert>
          )}

          <Delivery state={state} />

          {state.connected ? (
            <div className="space-y-3">
              <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
                <dt className="text-muted-foreground">провайдер</dt>
                <dd className="font-medium">monobank</dd>
                <dt className="text-muted-foreground">токен</dt>
                <dd className="font-mono">{state.tokenHint}</dd>
                <dt className="text-muted-foreground">підключено</dt>
                <dd>{state.connectedAt ? dateTimeLabel(state.connectedAt, session.timezone) : '—'}</dd>
              </dl>

              <Button variant="outline" disabled={busy} onClick={disconnect}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Link2Off aria-hidden />}
                Відключити
              </Button>
              <p className="text-xs text-muted-foreground">
                Після відключення студенти побачать, що оплата карткою недоступна. Уже проведені
                платежі лишаються в журналі.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {state.fallbackAvailable && (
                <Alert>
                  <TriangleAlert aria-hidden />
                  <AlertTitle>Зараз гроші йдуть не вам</AlertTitle>
                  <AlertDescription>
                    На сервері налаштований спільний токен розгортання, і рахунки виставляються
                    через нього. Поки ви не підключили власний рахунок, оплати студентів надходять
                    власнику цього токена, а не вам.
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="pay-token">Токен еквайрингу</Label>
                <Input
                  id="pay-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="вставте токен із кабінету провайдера"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={!state.canConnect}
                />
              </div>

              <Button
                disabled={busy || !state.canConnect || token.trim().length < 10}
                onClick={connect}
              >
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ShieldCheck aria-hidden />}
                Перевірити й підключити
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Де взяти токен</CardTitle>
          <CardDescription>monobank, «Plata by mono»</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="list-decimal space-y-2 pl-4">
            <li>
              Відкрийте <span className="font-mono">api.monobank.ua</span>, розділ еквайрингу.
            </li>
            <li>
              Для перевірки візьміть <strong>тестовий</strong> токен — справжні гроші при ньому не
              рухаються.
            </li>
            <li>Вставте його в поле ліворуч і натисніть «Перевірити й підключити».</li>
          </ol>

          <Alert>
            <ShieldCheck aria-hidden />
            <AlertDescription>
              Токен зберігається зашифрованим і назад не показується — лише останні символи, щоб ви
              впізнали, який саме підключено. Бойовий токен видають тільки за договором еквайрингу.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
