import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, GraduationCap, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import {
  ApiError,
  api,
  clearSession,
  loadSession,
  saveSession,
  type Balance,
  type Session,
} from '@/api/client';
import type { SlotView } from '@/api/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BalanceCard } from '@/features/balance/BalanceCard';
import { PaymentReturn, TopupCard } from '@/features/balance/Topup';
import { TelegramCard } from '@/features/profile/TelegramCard';
import { TimezoneCard } from '@/features/profile/TimezoneCard';
import { PasswordCard } from '@/features/profile/PasswordCard';
import { Calendar } from '@/features/calendar/Calendar';
import { CalendarFeedCard } from '@/features/calendar/CalendarFeedCard';
import { addDays, dayKey, weekAnchor, weekDays } from '@/features/calendar/time';
import { Login } from '@/routes/Login';
import { Register } from '@/routes/Register';
import { ResetPassword, VerifyEmail } from '@/routes/AuthLink';
import { TeacherHome } from '@/routes/TeacherHome';
import { Styleguide } from '@/routes/Styleguide';

/** Маршрутизації на два екрани вистачає хеша; бібліотека тут була б надміром. */
function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [cursor, setCursor] = useState(() => new Date());
  // «Зараз» тримаємо у стані й оновлюємо разом із даними: інакше кожен
  // перемальовок давав би новий момент, і підсвітка «сьогодні» та позначка
  // «минуло» залежали б від того, коли React вирішив перерендерити.
  const [now, setNow] = useState(() => new Date());
  const [slots, setSlots] = useState<SlotView[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  // Заняття, яке студент переносить. Поки воно задане, календар показує не
  // «забронювати», а «сюди»: у режимі переносу питання одне — куди.
  const [movingId, setMovingId] = useState<number | null>(null);
  const hash = useHash();
  // Сторінка станів — службова: специфікація інтерфейсу й скріншот для звіту.
  // Посилання на неї в інтерфейсі немає ні в кого, вона відкривається рівно за
  // адресою #styleguide.
  const styleguide = hash === '#styleguide';
  // Провайдер повертає користувача на #payment-<id>: за ним екран розуміє,
  // статус якого платежу опитувати.
  const returnedPayment = /^#payment-(\d+)$/.exec(hash)?.[1];
  /* Посилання з листа: `#verify-<код>` і `#reset-<код>`. Код прибирається з
     адреси одразу після зчитування — інакше він осідає в історії браузера. */
  const mailLink = /^#(verify|reset)-(.+)$/.exec(hash);
  const [registering, setRegistering] = useState(false);

  const tz = session?.timezone ?? 'UTC';
  const anchor = useMemo(() => weekAnchor(cursor, tz), [cursor, tz]);

  /** Зона змінилась — сесію треба оновити й у памʼяті, і у сховищі. */
  const changeTimezone = useCallback((timezone: string) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, timezone };
      saveSession(next);
      return next;
    });
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setSession(null);
    setSlots([]);
    setBalance(null);
  }, []);

  /** Прострочений токен не має залишати користувача на порожньому екрані. */
  const handle = useCallback(
    (e: unknown): string => {
      if (e instanceof ApiError && e.status === 401) {
        signOut();
        return 'сесія завершилась, увійдіть знову';
      }
      return e instanceof ApiError ? e.message : String(e);
    },
    [signOut],
  );

  const reload = useCallback(async () => {
    // Кабінет викладача вантажить свої дані сам, а /slots вимагає студента:
    // без цієї перевірки викладач отримував 401 і вилітав на форму входу.
    if (!session || session.role !== 'student') return;
    setLoading(true);
    setNow(new Date());
    try {
      // Беремо на добу ширше з обох боків: межі тижня в зоні студента не
      // збігаються з UTC, і без запасу крайні заняття зникали б із сітки.
      const [s, b] = await Promise.all([
        api.slots(session.token, addDays(anchor, -1), addDays(anchor, 8)),
        session.role === 'student' ? api.balance(session.token) : Promise.resolve(null),
      ]);
      setSlots(s);
      setBalance(b);
    } catch (e) {
      toast.error(handle(e));
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }, [session, anchor, handle]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Зайве з запасу відсікаємо тут, щоб сітка й лічильник вільних занять
  // рахували рівно показаний тиждень.
  const visible = useMemo(() => {
    const keys = new Set(weekDays(anchor).map((d) => dayKey(d, tz)));
    return slots.filter((s) => keys.has(dayKey(s.startAt, tz)));
  }, [slots, anchor, tz]);

  const act = async (slot: SlotView) => {
    if (!session) return;
    setActingId(slot.id);
    try {
      if (movingId !== null) {
        // У режимі переносу клік по вільному слоту означає «сюди», а не
        // «забронювати ще одне».
        const r = await api.reschedule(session.token, movingId, slot.id);
        setMovingId(null);
        toast.success('Заняття перенесено', {
          description: r.paid
            ? 'Оплата переїхала разом із заняттям'
            : 'Місце закріплене на новий час',
        });
      } else if (slot.state === 'free') {
        const r = await api.book(session.token, slot.id);
        if (r.paid) toast.success('Заняття оплачене з балансу');
        else toast.success('Місце закріплене', { description: 'Лишилось оплатити заняття' });
      } else {
        const r = await api.cancel(session.token, slot.id);
        if (r.refunded) toast.success('Скасовано', { description: 'Кошти повернуто на баланс' });
        else toast.success('Скасовано');
      }
      await reload();
    } catch (e) {
      toast.error(handle(e));
    } finally {
      setActingId(null);
    }
  };

  if (mailLink) {
    const [, route, token] = mailLink;
    const backToLogin = () => {
      window.location.hash = '';
      setRegistering(false);
    };
    return (
      <main className="flex min-h-dvh items-center justify-center p-4">
        {route === 'verify'
          ? <VerifyEmail token={decodeURIComponent(token!)} onDone={backToLogin} />
          : <ResetPassword token={decodeURIComponent(token!)} onDone={backToLogin} />}
      </main>
    );
  }

  if (!session) {
    if (registering) {
      return (
        <main className="flex min-h-dvh items-center justify-center p-4">
          <Register onBack={() => setRegistering(false)} />
        </main>
      );
    }

    return (
      <Login
        onRegister={() => setRegistering(true)}
        onReady={(s) => {
          saveSession(s);
          setSession(s);
          toast.success(`Вітаємо, ${s.name}`);
        }}
      />
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="bg-background/85 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex max-w-[110rem] items-center gap-2 px-6 py-3">
          <a href="#" className="flex items-center gap-2 font-semibold">
            <GraduationCap className="size-5 text-primary" aria-hidden />
            Tutorflow
          </a>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm sm:inline">{session.name}</span>
            <Badge variant="secondary">
              {session.role === 'student' ? 'студент' : 'викладач'}
            </Badge>
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut aria-hidden />
              <span className="hidden sm:inline">вийти</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[110rem] px-6 py-4">
        {styleguide ? (
          <Styleguide tz={tz} />
        ) : session.role === 'teacher' ? (
          <TeacherHome session={session} onTimezoneChange={changeTimezone} />
        ) : (
          <>
            {returnedPayment && (
              <PaymentReturn
                session={session}
                paymentId={Number(returnedPayment)}
                onSettled={() => void reload()}
              />
            )}
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="space-y-2">
                {movingId !== null && (
                  <Alert>
                    <ArrowRightLeft aria-hidden />
                    <AlertDescription className="flex flex-wrap items-center gap-2">
                      <span>Виберіть вільну годину, на яку перенести заняття.</span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto"
                        onClick={() => setMovingId(null)}
                      >
                        скасувати перенос
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                <Calendar
                  anchor={anchor}
                  tz={tz}
                  now={now}
                  slots={visible}
                  loading={loading}
                  actingId={actingId}
                  onAct={act}
                  movingId={movingId}
                  onMove={(slot) => setMovingId(slot.id)}
                  onWeekShift={(d) => setCursor((c) => addDays(c, d * 7))}
                  onToday={() => setCursor(new Date())}
                />
              </div>
              {balance && (
                <div className="space-y-4 xl:sticky xl:top-20">
                  <BalanceCard balance={balance} tz={tz} session={session} />
                  <TopupCard session={session} />
                  <TimezoneCard session={session} onChange={changeTimezone} />
                  <PasswordCard session={session} />
                  <TelegramCard session={session} />
                  <CalendarFeedCard session={session} />
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
