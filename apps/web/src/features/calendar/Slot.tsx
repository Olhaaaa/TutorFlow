import type { SlotView } from '../../api/types.js';
import { STATE } from './slot-state.js';
import { dateTimeLabel, hhmm, money } from './time.js';

interface Props {
  slot: SlotView;
  /** true — повний рядок для мобільного списку, false — клітинка сітки */
  wide?: boolean;
  busy?: boolean;
  onAct?: (slot: SlotView) => void;
}

export function Slot({ slot, wide = false, busy = false, onAct }: Props) {
  const s = STATE[slot.state];
  const start = new Date(slot.startAt);

  return (
    <div className={`slot slot--${s.token} ${wide ? 'slot--wide' : ''}`}>
      <div className="slot__head">
        {wide && <span className="slot__time">{hhmm(start)}</span>}
        <span className="slot__label">{s.label}</span>
        {wide && <span className="slot__price">{money(slot.priceMinor)}</span>}
      </div>

      {slot.state === 'mine_unpaid' && slot.payBy && (
        <div className="slot__note">оплатити до {dateTimeLabel(slot.payBy)}</div>
      )}

      {s.action && onAct && (
        <button
          className="slot__act"
          disabled={busy}
          onClick={() => onAct(slot)}
          aria-label={s.action === 'book' ? 'Забронювати заняття' : 'Скасувати заняття'}
        >
          {s.action === 'book' ? 'Взяти' : 'Скасувати'}
        </button>
      )}
    </div>
  );
}
