import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, loadIdentity, saveIdentity, type Identity } from './api/client.js';
import type { SlotView } from './api/types.js';
import { Calendar } from './features/calendar/Calendar.js';
import { addDays, startOfWeek } from './features/calendar/time.js';
import { Styleguide } from './routes/Styleguide.js';

/** Найпростіша маршрутизація, якої вистачає на два екрани: читаємо хеш і
 *  слухаємо його зміну. Бібліотека маршрутизації тут була б надміром. */
function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export function App() {
  const [identity, setIdentity] = useState<Identity | null>(loadIdentity);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [slots, setSlots] = useState<SlotView[]>([]);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const styleguide = useHash() === '#styleguide';

  const reload = useCallback(async () => {
    if (!identity) return;
    setLoading(true);
    setNotice(null);
    try {
      setSlots(await api.slots(identity, weekStart, addDays(weekStart, 7)));
    } catch (e) {
      setNotice(e instanceof ApiError ? `не вдалось завантажити: ${e.message}` : String(e));
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }, [identity, weekStart]);

  useEffect(() => { void reload(); }, [reload]);

  const act = async (slot: SlotView) => {
    if (!identity) return;
    setActingId(slot.id);
    setNotice(null);
    try {
      if (slot.state === 'free') {
        const r = await api.book(identity, slot.id);
        setNotice(
          r.paid
            ? 'заняття оплачене'
            : 'місце закріплене, лишилось оплатити',
        );
      } else {
        const r = await api.cancel(identity, slot.id);
        setNotice(r.refunded ? 'скасовано, кошти повернуто' : 'скасовано');
      }
      await reload();
    } catch (e) {
      setNotice(
        e instanceof ApiError && e.status === 501
          ? 'білінг ще не підключений — бронювання стане доступним разом із ним'
          : e instanceof ApiError
            ? e.message
            : String(e),
      );
    } finally {
      setActingId(null);
    }
  };

  if (styleguide) {
    return (
      <main className="shell">
        <a className="shell__back" href="#">← до календаря</a>
        <Styleguide />
      </main>
    );
  }

  if (!identity) return <IdentityForm onReady={(id) => { saveIdentity(id); setIdentity(id); }} />;

  return (
    <main className="shell">
      <header className="shell__top">
        <h1>Tutorflow</h1>
        <nav>
          <a href="#styleguide">стани слота</a>
          <button onClick={() => { localStorage.clear(); setIdentity(null); }}>змінити користувача</button>
        </nav>
      </header>

      {notice && <p className="shell__notice">{notice}</p>}

      <Calendar
        weekStart={weekStart}
        slots={slots}
        loading={loading}
        actingId={actingId}
        onAct={act}
        onWeekShift={(d) => setWeekStart((w) => addDays(w, d * 7))}
      />
    </main>
  );
}

/**
 * Тимчасовий вибір користувача. Справжній вхід зʼявиться разом із
 * автентифікацією; тоді цей компонент замінить форма з поштою й паролем, а
 * решта застосунку не змінюється — ідентичність усюди йде через api/client.
 */
function IdentityForm({ onReady }: { onReady: (id: Identity) => void }) {
  const [studentId, setStudentId] = useState('1');
  const [teacherId, setTeacherId] = useState('1');

  return (
    <main className="shell shell--narrow">
      <h1>Tutorflow</h1>
      <p className="shell__hint">
        Вхід ще не реалізований. Поки вкажіть, від чийого імені дивитись календар.
      </p>
      <form
        className="idform"
        onSubmit={(e) => {
          e.preventDefault();
          onReady({ studentId: Number(studentId), teacherId: Number(teacherId) });
        }}
      >
        <label>
          студент
          <input value={studentId} onChange={(e) => setStudentId(e.target.value)} inputMode="numeric" />
        </label>
        <label>
          викладач
          <input value={teacherId} onChange={(e) => setTeacherId(e.target.value)} inputMode="numeric" />
        </label>
        <button type="submit">Відкрити календар</button>
      </form>
    </main>
  );
}
