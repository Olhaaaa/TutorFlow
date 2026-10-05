import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, CreditCard, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api, type Session } from '@/api/client';
import type { PaymentStatus } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/** Типові суми: одне, два й чотири заняття за базовою ціною. */
const PRESETS = [500, 1000, 2000];

/**
 * Оплата карткою.
 *
 * Кнопка лише створює рахунок і відправляє користувача на сторінку провайдера.
 * Баланс змінить вебхук — тому після повернення ми не малюємо успіх одразу, а
 * питаємо сервер. Вірити редіректу не можна: параметри в URL підробляються.
 */
export function TopupCard({ session }: { session: Session }) {
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  // null — ще не знаємо; доки не знаємо, картку не малюємо взагалі, щоб вона
  // не блимнула й не зникла.
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    api.payments
      .options(session.token)
      .then((o) => alive && setEnabled(o.enabled))
      .catch(() => alive && setEnabled(false));
    return () => {
      alive = false;
    };
  }, [session.token]);

  const pay = async (hryvnia: number) => {
    if (!Number.isFinite(hryvnia) || hryvnia < 100) {
      toast.error('мінімальна сума — 100 ₴');
      return;
    }
    setBusy(true);
    try {
      const payment = await api.payments.create(session.token, Math.round(hryvnia * 100));
      if (!payment.pageUrl) throw new Error('провайдер не повернув сторінку оплати');
      window.location.assign(payment.pageUrl);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        toast.error('Оплата карткою ще не налаштована', {
          description: 'Поки що баланс поповнює викладач вручну',
        });
      } else {
        toast.error(e instanceof Error ? e.message : String(e));
      }
      setBusy(false);
    }
  };

  if (enabled === null) return null;

  if (!enabled) {
    return (
      <Card className="gap-2">
        <CardHeader className="gap-1">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <CreditCard className="size-4" aria-hidden />
            Оплата карткою недоступна
          </CardTitle>
          <CardDescription>
            Викладач ще не підключив приймання оплати. Поки що баланс поповнює він вручну —
            домовтесь, як вам зручніше передати кошти.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="gap-3">
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <CreditCard className="size-4" aria-hidden />
          Поповнити карткою
        </CardTitle>
        <CardDescription>
          Оплата відкриється на сторінці банку. Кошти зарахуються автоматично, щойно банк
          підтвердить платіж.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <Button key={p} size="sm" variant="outline" disabled={busy} onClick={() => pay(p)}>
              {p} ₴
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            inputMode="numeric"
            placeholder="своя сума"
            className="h-8"
            aria-label="Сума поповнення"
          />
          <Button
            size="sm"
            disabled={busy || custom.trim() === ''}
            onClick={() => pay(Number(custom.replace(',', '.')))}
          >
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : 'Оплатити'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const POLL_MS = 2_000;
const GIVE_UP_AFTER = 30; // спроб, тобто хвилина

const DONE: Record<Exclude<PaymentStatus, 'pending'>, { text: string; ok: boolean }> = {
  paid: { text: 'Оплата пройшла, кошти на балансі', ok: true },
  failed: { text: 'Банк відхилив платіж', ok: false },
  expired: { text: 'Час на оплату вийшов', ok: false },
};

/**
 * Екран повернення з платіжної сторінки.
 *
 * Вебхук провайдера цілком може прийти ПІЗНІШЕ, ніж користувач повернеться у
 * застосунок, тому статус опитується, а не читається один раз. Якщо за хвилину
 * нічого не змінилось — це не помилка: платіж дообробиться, просто не на очах.
 */
export function PaymentReturn({
  session,
  paymentId,
  onSettled,
}: {
  session: Session;
  paymentId: number;
  onSettled: () => void;
}) {
  const [status, setStatus] = useState<PaymentStatus>('pending');
  const [gaveUp, setGaveUp] = useState(false);
  const tries = useRef(0);
  const settled = useRef(false);

  const finish = useCallback(
    (s: Exclude<PaymentStatus, 'pending'>) => {
      if (settled.current) return;
      settled.current = true;
      setStatus(s);
      const d = DONE[s];
      if (d.ok) toast.success(d.text);
      else toast.error(d.text);
      onSettled();
      window.location.hash = '';
    },
    [onSettled],
  );

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      if (!alive || settled.current) return;
      tries.current += 1;
      try {
        const p = await api.payments.status(session.token, paymentId);
        if (p.status !== 'pending') {
          finish(p.status);
          return;
        }
      } catch {
        // мережа смикнулась — наступна спроба за дві секунди
      }
      if (tries.current >= GIVE_UP_AFTER) setGaveUp(true);
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [session.token, paymentId, finish]);

  if (status !== 'pending') return null;

  return (
    <Card className="mb-4">
      <CardContent className="flex items-center gap-3 py-4">
        {gaveUp ? (
          <CircleAlert className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <Loader2 className="size-5 shrink-0 animate-spin text-primary" aria-hidden />
        )}
        <div>
          <p className="text-sm font-medium">
            {gaveUp ? 'Підтвердження ще не надійшло' : 'Чекаємо підтвердження банку…'}
          </p>
          <p className="text-sm text-muted-foreground">
            {gaveUp
              ? 'Платіж дообробиться автоматично — сторінку можна закрити, баланс оновиться.'
              : 'Закривати сторінку не обовʼязково, це займає кілька секунд.'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => {
            window.location.hash = '';
            onSettled();
          }}
        >
          <CircleCheck aria-hidden />
          сховати
        </Button>
      </CardContent>
    </Card>
  );
}
