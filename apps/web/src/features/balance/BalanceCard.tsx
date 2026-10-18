import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Balance, type HistoryDirection, type Session, type Transaction } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { dateTimeLabel, money } from '../calendar/time';

const KIND: Record<string, string> = {
  topup: 'поповнення',
  lesson_charge: 'заняття',
  refund: 'повернення',
  adjustment: 'коригування',
};

/**
 * Скільки рядків журналу видно без прокрутки. Висота рахується з цього числа,
 * а не задається на око: рядок — назва плюс дата, тобто 2.75rem разом із
 * проміжком.
 */
const ROWS_VISIBLE = 5;
const ROW_HEIGHT_REM = 2.75;

/**
 * Напрямки у вигляді, придатному для перемикача. Підписи навмисно не
 * «надходження/витрати»: студент бачить це як «мені нарахували» і «з мене
 * зняли».
 */
const DIRECTIONS: { value: HistoryDirection; label: string }[] = [
  { value: 'all', label: 'усі' },
  { value: 'in', label: 'поповнення' },
  { value: 'out', label: 'списання' },
];

export function BalanceCard(
  { balance, tz, session }: { balance: Balance; tz: string; session: Session },
) {
  const [direction, setDirection] = useState<HistoryDirection>('all');
  const [rows, setRows] = useState<Transaction[]>(balance.history);
  const [loading, setLoading] = useState(false);
  const owing = balance.dueMinor > 0;

  /*
    `all` уже приїхало разом із балансом — другого запросу по те саме не
    робимо. Решта напрямків ходить на сервер, і саме в цьому суть: вікно
    журналу обмежене двадцятьма операціями, тож у студента з довгою історією
    поповнення в нього не потрапляє взагалі. Фільтрувати локально було б
    нічого.
  */
  useEffect(() => {
    if (direction === 'all') {
      setRows(balance.history);
      return;
    }

    // Відповідь на застарілий запрос не має перекривати свіжіший: напрямки
    // перемикають швидше, ніж відповідає мережа.
    let current = true;
    setLoading(true);
    api.history(session.token, direction)
      .then((r) => { if (current) setRows(r); })
      .catch((e: unknown) => {
        if (current) toast.error(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (current) setLoading(false); });

    return () => { current = false; };
  }, [direction, balance.history, session.token]);

  return (
    <Card className="gap-4">
      <CardHeader className="gap-1">
        <CardDescription className="flex items-center gap-1.5">
          <Wallet className="size-3.5" aria-hidden />
          баланс
        </CardDescription>
        <CardTitle className="font-mono text-3xl tabular-nums">
          {money(balance.balanceMinor)}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {owing ? (
          <div className="space-y-2 rounded-md border border-slot-unpaid-border bg-slot-unpaid p-3 text-slot-unpaid-fg">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <CircleAlert className="size-4" aria-hidden />
              до сплати {money(balance.dueMinor)}
            </p>
            <ul className="space-y-1 text-sm">
              {balance.unpaid.map((u) => (
                <li key={u.slotId} className="flex justify-between gap-2">
                  <span>{dateTimeLabel(u.startAt, tz)}</span>
                  <span className="font-mono tabular-nums">{money(u.priceMinor)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs opacity-90">
              Поповнення зараховується на найближчі заняття автоматично, від найраніших.
            </p>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 rounded-md border border-slot-paid-border bg-slot-paid p-3 text-sm text-slot-paid-fg">
            <CircleCheck className="size-4" aria-hidden />
            Усі заняття оплачені
          </p>
        )}

        <Separator />

        <div className="space-y-2">
          <p className="flex items-baseline justify-between gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <span>історія операцій</span>
            {/*
              Кількість переїхала сюди з кнопки «показати всі»: прокрутка не
              каже, скільки рядків нижче, а знати це корисно.
            */}
            {!loading && rows.length > 0 && <span className="tabular-nums">{rows.length}</span>}
          </p>

          <div className="flex gap-1" role="group" aria-label="напрямок операцій">
            {DIRECTIONS.map((d) => (
              <Button
                key={d.value}
                size="xs"
                variant={direction === d.value ? 'default' : 'outline'}
                aria-pressed={direction === d.value}
                onClick={() => setDirection(d.value)}
              >
                {d.label}
              </Button>
            ))}
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">завантаження…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {direction === 'in'
                ? 'поповнень ще не було'
                : direction === 'out'
                  ? 'списань ще не було'
                  : 'операцій ще не було'}
            </p>
          ) : (
            /*
              Прокрутка всередині картки, а не розгортання: журнал не зсуває
              сусідні картки й не змінює висоту сторінки. Межа — максимум, а не
              фіксована висота: коли операцій три, блок займає рівно три рядки.
            */
            <ul
              className="space-y-1.5 overflow-y-auto pr-1 text-sm"
              style={{ maxHeight: `${ROWS_VISIBLE * ROW_HEIGHT_REM}rem` }}
              // Прокручувана область мусить фокусуватися з клавіатури, інакше
              // дістатися нижніх рядків без миші неможливо.
              tabIndex={0}
              aria-label="історія операцій"
            >
              {rows.map((t) => (
                <li key={t.id} className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{KIND[t.kind] ?? t.kind}</span>
                    <span className="text-xs text-muted-foreground">
                      {dateTimeLabel(t.at, tz)}
                    </span>
                  </span>
                  {/*
                    Обидва напрямки малюються однаково: --slot-paid-fg — це
                    КРЕМОВИЙ колір тексту поверх соснової заливки, і на світлій
                    картці він зливався з фоном. Напрямок читається зі знака.
                  */}
                  <Badge variant="outline" className="font-mono tabular-nums text-muted-foreground">
                    {t.amountMinor > 0 ? '+' : ''}
                    {money(t.amountMinor)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
