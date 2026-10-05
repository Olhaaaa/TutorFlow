import { useState } from 'react';
import { CircleAlert, CircleCheck, Wallet } from 'lucide-react';
import type { Balance } from '@/api/client';
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

const SHORT = 4;

export function BalanceCard({ balance, tz }: { balance: Balance; tz: string }) {
  const [full, setFull] = useState(false);
  const owing = balance.dueMinor > 0;
  const history = full ? balance.history : balance.history.slice(0, SHORT);

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
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            історія операцій
          </p>

          {balance.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">операцій ще не було</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {history.map((t) => (
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

          {balance.history.length > SHORT && (
            <Button variant="ghost" size="sm" className="w-full" onClick={() => setFull(!full)}>
              {full ? 'згорнути' : `показати всі (${balance.history.length})`}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
