import {
  CalendarCheck,
  CalendarPlus,
  CircleAlert,
  CircleSlash,
  History,
  Lock,
  type LucideIcon,
} from 'lucide-react';
import type { SlotState, SlotView } from '@/api/types';
import { isPast } from './time';

/** Як стан виглядає в інтерфейсі: колір, підпис, пояснення, доступна дія. */
export interface StateStyle {
  /** Короткий підпис — він стоїть у клітинці сітки, місця там мало. */
  label: string;
  /** Людське пояснення: що це означає і що буде далі. */
  hint: string;
  /** Набір кольорів у index.css: --slot-{variant}, -border, -fg */
  variant: 'free' | 'unpaid' | 'paid' | 'busy' | 'past' | 'late';
  action: 'book' | 'cancel' | null;
  Icon: LucideIcon;
}

export const STATE: Record<SlotState, StateStyle> = {
  free: {
    label: 'вільно',
    hint: 'Можна забронювати. Якщо на балансі є кошти, заняття одразу стане оплаченим.',
    variant: 'free',
    action: 'book',
    Icon: CalendarPlus,
  },
  mine_unpaid: {
    label: 'не оплачено',
    hint: 'Місце закріплене за вами. Без оплати до вказаного часу воно звільниться.',
    variant: 'unpaid',
    action: 'cancel',
    Icon: CircleAlert,
  },
  mine_paid: {
    label: 'оплачено',
    hint: 'Заняття оплачене. Скасування завчасно повертає кошти на баланс.',
    variant: 'paid',
    action: 'cancel',
    Icon: CalendarCheck,
  },
  busy: {
    label: 'зайнято',
    hint: 'Цей час уже взяв інший студент.',
    variant: 'busy',
    action: null,
    Icon: Lock,
  },
  mine_done: {
    label: 'проведено',
    hint: 'Заняття відбулося.',
    variant: 'past',
    action: null,
    Icon: History,
  },
  mine_cancelled_late: {
    label: 'скасовано пізно',
    hint: 'Скасовано пізніше за дозволений строк, кошти не повертаються.',
    variant: 'late',
    action: null,
    Icon: CircleSlash,
  },
};

/** Вільний слот, час якого вже минув: сервер його не віддасть, і кнопки немає. */
const EXPIRED: StateStyle = {
  label: 'минуло',
  hint: 'Цей час уже минув.',
  variant: 'past',
  action: null,
  Icon: History,
};

/**
 * Єдине місце, де слот перетворюється на свій вигляд. Минулий час гаситься тут,
 * а не в кожному екрані — інакше інтерфейс пропонує дію, яку сервер відхилить.
 */
export function displayOf(slot: SlotView, now?: Date): StateStyle {
  const style = STATE[slot.state];
  if (style.action === 'book' && isPast(slot.startAt, now)) return EXPIRED;
  return style;
}

/** Порядок для сторінки стилів — від вільного до кінцевих станів. */
export const ALL_STATES: SlotState[] = [
  'free',
  'mine_unpaid',
  'mine_paid',
  'busy',
  'mine_done',
  'mine_cancelled_late',
];
