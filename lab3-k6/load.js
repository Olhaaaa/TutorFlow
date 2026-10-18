/**
 * Базовий замір критичного шляху: читання календаря й бронювання зі списанням.
 *
 * Два сценарії йдуть ОДНОЧАСНО, бо так і буває: поки одні дивляться розклад,
 * інші бронюють. Розділяти їх означало б міряти те, чого не існує.
 *
 * Що саме міряється:
 *   calendar_read  — GET /api/slots, найчастіший запрос застосунку;
 *   booking_write  — POST /api/slots/:id/book, критичний шлях із грошима.
 *
 * Пороги підібрані як межа притомності, а не як обіцянка: якщо моноліт їх не
 * тримає, порівнювати його з мікросервісами ще рано.
 *
 *   docker run --rm -i --network host -v "$PWD/lab3-k6":/s grafana/k6 \
 *     run /s/load.js -e BASE=http://localhost:8081
 */
import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { BASE, STUDENTS, TEACHER, auth, calendarWindow, freeSlots, login, topUp } from './lib.js';

const readTime = new Trend('calendar_read', true);
const writeTime = new Trend('booking_write', true);
const booked = new Counter('booking_ok');
const conflict = new Counter('booking_conflict');
const failed = new Counter('booking_failed');
const exhausted = new Counter('slots_exhausted');

/*
 * 409 — не помилка, а відповідь домену: слот щойно забрали. За замовчуванням
 * k6 рахує будь-який 4xx як невдалий запрос, і тоді `http_req_failed`
 * показував би збої там, де система поводиться рівно так, як задумано.
 */
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409));

export const options = {
  scenarios: {
    reads: {
      executor: 'constant-arrival-rate',
      rate: 40,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 20,
      maxVUs: 60,
      exec: 'readCalendar',
    },
    writes: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 10,
      maxVUs: 30,
      exec: 'bookSlot',
    },
  },
  thresholds: {
    'calendar_read': ['p(95)<800'],
    'booking_write': ['p(95)<1000'],
    'booking_failed': ['count==0'],
    // Конфліктів тут бути не повинно: кожна ітерація бере власний слот.
    // Якщо вони з'явились — або слоти вичерпались, або поламався розподіл.
    'booking_conflict': ['count==0'],
    'http_req_failed': ['rate<0.01'],
  },
};

export function setup() {
  const teacher = login(TEACHER);
  const students = STUDENTS.map((email) => {
    const s = login(email);
    topUp(teacher.token, s.id);
    return s;
  });

  const free = freeSlots(students[0].token);
  if (free.length < 50) {
    throw new Error(`вільних слотів лише ${free.length} — залийте демо-дані сідером`);
  }

  return { tokens: students.map((s) => s.token), free };
}

export function readCalendar(data) {
  const token = data.tokens[__VU % data.tokens.length];
  const res = http.get(`${BASE}/api/slots?${calendarWindow()}`, auth(token));

  readTime.add(res.timings.duration);
  check(res, { 'календар віддано': (r) => r.status === 200 });
}

export function bookSlot(data) {
  /*
   * Кожна ітерація бере СВІЙ слот: мета цього сценарію — пропускна здатність
   * шляху «слот плюс гроші», а не боротьба за одну годину. Конкуренцію за
   * один слот міряє contention.js.
   *
   * Номер береться з `iterationInTest`, а не з пари `__VU`/`__ITER`: при
   * виконавці зі сталою частотою ітерації роздаються вільним VU, тому
   * обчислений із них індекс збігався в різних користувачів — і сценарій сам
   * собі створював конкуренцію, якої не мав міряти.
   */
  const index = exec.scenario.iterationInTest % data.free.length;
  const slotId = data.free[index];
  const token = data.tokens[__VU % data.tokens.length];

  const res = http.post(`${BASE}/api/slots/${slotId}/book`, null, auth(token));
  writeTime.add(res.timings.duration);

  if (res.status === 201) booked.add(1);
  else if (res.status === 409) conflict.add(1);
  else failed.add(1);

  check(res, {
    'бронювання завершилось однозначно': (r) => r.status === 201 || r.status === 409,
  });

  // Коли вільні слоти вичерпались, 409 перестає бути ознакою конкуренції й
  // стає ознакою того, що замір треба перезапустити на свіжих даних.
  if (res.status === 409) exhausted.add(1);
}
