import type { SlotStatusColumn } from '../db/schema.js';

/**
 * Як слот виглядає для конкретного глядача. Пʼять станів із плану, і це саме
 * ті стани, під які фронтенд має токени кольорів.
 *
 * Чуже заняття завжди `busy` — без статусу й без імені студента. Хто саме
 * займає годину, видно лише в кабінеті викладача.
 */
export type SlotViewState =
  | 'free'
  | 'mine_unpaid'
  | 'mine_paid'
  | 'busy'
  | 'mine_done'
  | 'mine_cancelled_late';

export function toViewState(
  status: SlotStatusColumn,
  slotStudentId: number | null,
  viewerStudentId: number | null,
): SlotViewState {
  if (status === 'free') return 'free';
  const mine = slotStudentId !== null && slotStudentId === viewerStudentId;
  if (!mine) return 'busy';
  switch (status) {
    case 'pre_booked': return 'mine_unpaid';
    case 'booked': return 'mine_paid';
    case 'done': return 'mine_done';
    case 'cancelled_late': return 'mine_cancelled_late';
    default: return 'busy';
  }
}

export interface SlotView {
  id: number;
  /** ISO 8601 в UTC. Конвертацію в зону глядача робить фронтенд. */
  startAt: string;
  endAt: string;
  priceMinor: number;
  state: SlotViewState;
  /** Лише для свого неоплаченого слота: до коли треба заплатити. */
  payBy: string | null;
}

/**
 * Як слот виглядає для ВИКЛАДАЧА. Відмінність від студентського погляду
 * принципова: тут віддається сирий статус і імʼя студента, бо це його розклад
 * і його гроші. Саме тому це окремий тип і окремий маршрут, а не прапорець
 * у наявному: один обробник, який віддає різні поля різним ролям, рано чи
 * пізно віддасть зайве не тій ролі.
 */
export interface TeacherSlotView {
  id: number;
  startAt: string;
  endAt: string;
  priceMinor: number;
  status: SlotStatusColumn;
  student: { id: number; name: string } | null;
  /** Для неоплаченого закріплення: до коли воно тримається. */
  payBy: string | null;
}
