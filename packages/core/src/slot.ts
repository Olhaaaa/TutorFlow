/**
 * Автомат станів слота. Спільний для розкладу й білінгу, бо переходи ініціюють
 * і розклад (бронювання, скасування), і білінг (конвертація після оплати).
 *
 * Різниця між `pre_booked` і `booked` одна й однозначна: чи списані гроші.
 * `pre_booked` — місце закріплене за студентом, але не оплачене.
 */
export const SLOT_STATUSES = ['free', 'pre_booked', 'booked', 'done', 'cancelled_late'] as const;

export type SlotStatus = (typeof SLOT_STATUSES)[number];

/** Хто ініціює перехід — потрібно для повідомлень про помилки й для логів. */
export type TransitionActor = 'student' | 'teacher' | 'billing' | 'scheduler';

export const LEGAL_TRANSITIONS: Readonly<Record<SlotStatus, readonly SlotStatus[]>> = {
  // генератор за закріпленням, або студент без достатнього балансу → pre_booked
  // студент із достатнім балансом → booked
  free: ['pre_booked', 'booked'],
  // білінг після поповнення → booked; скасування або спливлий hold → free
  pre_booked: ['booked', 'free'],
  // вчасне скасування → free; пізнє → cancelled_late; час минув → done
  booked: ['free', 'cancelled_late', 'done'],
  done: [],
  cancelled_late: [],
};

/** Статуси, що займають час викладача: саме для них діє заборона перетину. */
export const OCCUPYING_STATUSES: readonly SlotStatus[] = ['pre_booked', 'booked', 'done'];

export function isOccupying(status: SlotStatus): boolean {
  return OCCUPYING_STATUSES.includes(status);
}

export function canTransition(from: SlotStatus, to: SlotStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: SlotStatus,
    readonly to: SlotStatus,
    readonly actor?: TransitionActor,
  ) {
    const by = actor ? ` (ініціатор: ${actor})` : '';
    super(`неприпустимий перехід слота ${from} → ${to}${by}`);
    this.name = 'IllegalTransitionError';
  }
}

export function assertTransition(from: SlotStatus, to: SlotStatus, actor?: TransitionActor): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to, actor);
}
