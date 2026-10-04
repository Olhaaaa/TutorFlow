import type { SlotState } from '../../api/types.js';

/** Опис стану для інтерфейсу: колір, підпис, чи можна діяти. */
export interface StateStyle {
  label: string;
  /** Префікс CSS-змінних у tokens.css: --{token}-bg, --{token}-line, --{token}-ink */
  token: 'free' | 'unpaid' | 'paid' | 'busy' | 'past' | 'late';
  action: 'book' | 'cancel' | null;
}

export const STATE: Record<SlotState, StateStyle> = {
  free: { label: 'вільно', token: 'free', action: 'book' },
  mine_unpaid: { label: 'не оплачено', token: 'unpaid', action: 'cancel' },
  mine_paid: { label: 'оплачено', token: 'paid', action: 'cancel' },
  busy: { label: 'зайнято', token: 'busy', action: null },
  mine_done: { label: 'проведено', token: 'past', action: null },
  mine_cancelled_late: { label: 'скасовано пізно', token: 'late', action: null },
};

/** Порядок для сторінки стилів — від вільного до кінцевих станів. */
export const ALL_STATES: SlotState[] = [
  'free', 'mine_unpaid', 'mine_paid', 'busy', 'mine_done', 'mine_cancelled_late',
];
