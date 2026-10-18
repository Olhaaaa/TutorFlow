/**
 * Головний інваріант системи під навантаженням: одну годину не можна
 * забронювати двічі.
 *
 * Сценарій навмисно неприродний — 60 одночасних спроб узяти ОДИН І ТОЙ САМИЙ
 * слот. У житті так не буває, але саме тут видно різницю між архітектурами,
 * заради якої робиться ця лабораторна: у моноліті захоплення слота й списання
 * коштів лежать в одній транзакції, і база серіалізує їх сама. У мікросервісах
 * спільної транзакції не буде, і цей самий сценарій покаже, чим за це
 * платиться.
 *
 * Поріг тут не про швидкість, а про коректність: `bookings_won` мусить
 * дорівнювати РІВНО одиниці. Якщо стане два — порівнювати продуктивність уже
 * немає сенсу, бо система продала ту саму годину двічі.
 *
 *   docker run --rm -i --network host -v "$PWD/lab3-k6":/s grafana/k6 \
 *     run /s/contention.js -e BASE=http://localhost:8081
 */
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE, STUDENTS, TEACHER, auth, freeSlots, login, topUp } from './lib.js';

const won = new Counter('bookings_won');
const lost = new Counter('bookings_lost');
const unexpected = new Counter('bookings_unexpected');

export const options = {
  scenarios: {
    contention: {
      executor: 'per-vu-iterations',
      vus: 60,
      iterations: 1,
      // Старт одночасний: саме збіг у часі й перевіряється.
      maxDuration: '30s',
    },
  },
  thresholds: {
    bookings_won: ['count==1'],
    bookings_unexpected: ['count==0'],
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
  if (free.length === 0) throw new Error('немає вільних слотів — залийте демо-дані сідером');

  // Один слот на всіх: саме за нього й буде боротьба.
  return { slotId: free[0], tokens: students.map((s) => s.token) };
}

export default function (data) {
  // Студентів троє, віртуальних користувачів більше: кілька VU грають одного
  // студента. Для перевірки це не має значення — захоплення слота атомарне
  // незалежно від того, хто саме прийшов.
  const token = data.tokens[__VU % data.tokens.length];
  const res = http.post(`${BASE}/api/slots/${data.slotId}/book`, null, auth(token));

  if (res.status === 201) won.add(1);
  else if (res.status === 409) lost.add(1);
  else unexpected.add(1);

  check(res, {
    'відповідь однозначна: або забронював, або слот зайнятий': (r) =>
      r.status === 201 || r.status === 409,
  });
}

export function teardown(data) {
  // Слот лишається зайнятим — наступний прогін візьме інший вільний.
  // Повертати систему в початковий стан має сідер, а не тест: інакше
  // прибирання саме стало б частиною заміру.
  console.log(`слот ${data.slotId} використано`);
}
