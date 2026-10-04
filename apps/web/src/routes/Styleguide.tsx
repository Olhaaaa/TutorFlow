import { Slot } from '../features/calendar/Slot.js';
import { ALL_STATES, STATE } from '../features/calendar/slot-state.js';
import type { SlotView } from '../api/types.js';

/**
 * Сторінка стилів. Малює всі стани слота поруч — це водночас специфікація для
 * тих, хто пише екрани, і скріншот для звіту, який не може розійтися з
 * реалізацією, бо бере ті самі компоненти й ті самі токени.
 */
const SAMPLE = (state: SlotView['state'], i: number): SlotView => ({
  id: -i,
  startAt: `2026-10-21T13:00:00.000Z`,
  endAt: `2026-10-21T14:00:00.000Z`,
  priceMinor: 50000,
  state,
  payBy: state === 'mine_unpaid' ? '2026-10-20T13:00:00.000Z' : null,
});

export function Styleguide() {
  return (
    <div className="sg">
      <h2>Стани слота</h2>
      <p className="sg__note">
        Кольори визначені в <code>tokens.css</code>. Жоден екран не задає їх самостійно.
      </p>

      <h3>Клітинка сітки</h3>
      <div className="sg__row">
        {ALL_STATES.map((s, i) => (
          <div key={s} className="sg__item">
            <Slot slot={SAMPLE(s, i)} onAct={() => {}} />
            <code>{s}</code>
          </div>
        ))}
      </div>

      <h3>Рядок у списку дня</h3>
      <div className="sg__col">
        {ALL_STATES.map((s, i) => (
          <Slot key={s} slot={SAMPLE(s, i)} wide onAct={() => {}} />
        ))}
      </div>

      <h3>Дія для кожного стану</h3>
      <table className="sg__table">
        <thead><tr><th>стан</th><th>підпис</th><th>дія</th></tr></thead>
        <tbody>
          {ALL_STATES.map((s) => (
            <tr key={s}>
              <td><code>{s}</code></td>
              <td>{STATE[s].label}</td>
              <td>{STATE[s].action ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
