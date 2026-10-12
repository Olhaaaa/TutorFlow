import { type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import type { SlotView } from '@/api/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { displayOf } from './slot-state';
import { slotBox } from './slot-variants';
import { dateTimeLabel, hhmm, isPast, money } from './time';

interface Props extends Pick<VariantProps<typeof slotBox>, 'shape'> {
  slot: SlotView;
  /** Зона студента: час малюється в ній, а не в зоні браузера. */
  tz: string;
  /** Момент, відносно якого слот вважається минулим. */
  now?: Date;
  /** true, доки запрос по цьому слоту в дорозі */
  acting?: boolean;
  onAct?: (slot: SlotView) => void;
  /** Увімкнений режим переносу: вільні слоти стають цілями, а не бронюванням. */
  moving?: boolean;
  /** Саме це заняття зараз переносять. */
  isSource?: boolean;
  /** Почати перенос цього заняття. */
  onMove?: (slot: SlotView) => void;
}

export function Slot({
  slot, tz, now, shape = 'cell', acting = false, onAct,
  moving = false, isSource = false, onMove,
}: Props) {
  const s = displayOf(slot, now);
  const { Icon } = s;
  const row = shape === 'row';
  const time = hhmm(slot.startAt, tz);
  // На суцільній сосновій заливці звичайна outline-кнопка нечитабельна:
  // вона мусить брати колір від самого слота.
  const onSolid = s.variant === 'paid';

  /*
   * У режимі переносу інтерфейс мусить говорити одне: куди. Тому вільний слот
   * пропонує «сюди» замість «Забронювати», а кнопки скасування в цей час немає
   * взагалі — інакше один клік мимо означав би скасоване заняття.
   */
  if (moving) {
    const target = s.action === 'book' && onAct && (
      <Button
        size={row ? 'sm' : 'xs'}
        variant="outline"
        className={cn(row ? '' : 'mt-1 w-full', 'border-primary/50 bg-transparent text-primary hover:bg-primary/10')}
        disabled={acting}
        onClick={() => onAct(slot)}
        aria-label={`Перенести на ${time}`}
      >
        {acting && <Loader2 className="animate-spin" aria-hidden />}
        сюди
      </Button>
    );

    return (
      <div
        className={cn(
          slotBox({ variant: s.variant, shape }),
          isSource && 'ring-2 ring-primary ring-offset-1',
        )}
        title={isSource ? 'Це заняття переносимо' : s.hint}
      >
        <div className="flex items-center gap-1">
          <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
          <span className="font-mono text-sm font-medium tabular-nums">{time}</span>
        </div>
        <span className="line-clamp-2 text-xs leading-tight">
          {isSource ? 'переносимо' : s.label}
        </span>
        {target}
      </div>
    );
  }

  const move = s.action === 'cancel' && onMove && !isPast(slot.startAt, now) && (
    <Button
      size={row ? 'sm' : 'xs'}
      variant="ghost"
      className={cn(
        row ? '' : 'w-full',
        onSolid && 'text-slot-paid-fg hover:bg-slot-paid-fg/15 hover:text-slot-paid-fg',
      )}
      disabled={acting}
      onClick={() => onMove(slot)}
      aria-label={`Перенести заняття ${time}`}
    >
      перенести
    </Button>
  );

  const action = s.action && onAct && (
    <Button
      size={row ? 'sm' : 'xs'}
      variant="outline"
      className={cn(
        row ? '' : 'mt-1 w-full',
        // Прозора з обводкою: кнопка не повинна перебивати собою стан слота,
        // а колір тексту лишає її головною дією в клітинці.
        s.action === 'book' && 'border-primary/50 bg-transparent text-primary hover:bg-primary/10',
        onSolid &&
          'border-slot-paid-fg/40 bg-transparent text-slot-paid-fg hover:bg-slot-paid-fg/15 hover:text-slot-paid-fg',
      )}
      disabled={acting}
      onClick={() => onAct(slot)}
      aria-label={
        s.action === 'book' ? `Забронювати заняття ${time}` : `Скасувати заняття ${time}`
      }
    >
      {acting && <Loader2 className="animate-spin" aria-hidden />}
      {s.action === 'book' ? 'Забронювати' : 'Скасувати'}
    </Button>
  );

  if (row) {
    return (
      <div className={cn(slotBox({ variant: s.variant, shape }))} title={s.hint}>
        <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2">
            <span className="font-mono text-sm font-medium tabular-nums">{time}</span>
            <span className="truncate text-sm">{s.label}</span>
          </p>
          {slot.state === 'mine_unpaid' && slot.payBy && (
            <p className="text-xs opacity-90">оплатити до {dateTimeLabel(slot.payBy, tz)}</p>
          )}
        </div>
        <span className="font-mono text-sm tabular-nums opacity-80">{money(slot.priceMinor)}</span>
        {move}
        {action}
      </div>
    );
  }

  return (
    <div className={cn(slotBox({ variant: s.variant, shape }))} title={s.hint}>
      <div className="flex items-center gap-1">
        <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
        <span className="font-mono text-sm font-medium tabular-nums">{time}</span>
      </div>
      <span className="line-clamp-2 text-xs leading-tight">{s.label}</span>
      {slot.state === 'mine_unpaid' && slot.payBy && (
        <span className="text-[0.7rem] leading-tight opacity-90">
          до {dateTimeLabel(slot.payBy, tz)}
        </span>
      )}
      {action}
      {move}
    </div>
  );
}
