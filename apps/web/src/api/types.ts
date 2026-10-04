/** Стани слота очима конкретного глядача. Віддає GET /api/slots. */
export type SlotState =
  | 'free'
  | 'mine_unpaid'
  | 'mine_paid'
  | 'busy'
  | 'mine_done'
  | 'mine_cancelled_late';

export interface SlotView {
  id: number;
  /** ISO 8601 в UTC. Усі перетворення в локальний час — лише при відображенні. */
  startAt: string;
  endAt: string;
  priceMinor: number;
  state: SlotState;
  /** Для свого неоплаченого слота: до коли треба заплатити. */
  payBy: string | null;
}

export interface BookResult {
  id: number;
  status: 'booked' | 'pre_booked';
  paid: boolean;
  payBy: string | null;
}

export interface CancelResult {
  id: number;
  status: 'free' | 'cancelled_late';
  refunded: boolean;
}
