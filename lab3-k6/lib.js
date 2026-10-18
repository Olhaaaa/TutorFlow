/**
 * Спільне для навантажувальних сценаріїв: вхід, підготовка даних, вибір слотів.
 *
 * Жодної логіки вимірювання тут немає — лише те, без чого сценарій не почнеться.
 * Так кожен сценарій лишається читабельним: видно, що саме він навантажує.
 */
import http from 'k6/http';

export const BASE = __ENV.BASE || 'http://localhost:8081';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Усі демо-акаунти мають однаковий пароль; він лежить у сідері, не в секретах. */
const PASSWORD = 'tutorflow';

export function login(email) {
  const res = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ email, password: PASSWORD }),
    { headers: JSON_HEADERS },
  );
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`вхід ${email} не вдався: ${res.status} ${res.body}`);
  }
  const body = res.json();
  return { token: body.token, id: body.id, name: body.name };
}

/**
 * Заголовки для запросу БЕЗ тіла.
 *
 * `Content-Type: application/json` тут навмисно немає: Fastify відхиляє
 * запрос, який оголошує JSON і приходить порожнім, — і бронювання, у якого
 * тіла немає, падало б із 400 замість 201. Те саме правило діє і в
 * клієнтському коді застосунку.
 */
export const auth = (token) => ({
  headers: { Authorization: `Bearer ${token}` },
});

/** Заголовки для запросу З тілом. */
export const authJson = (token) => ({
  headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
});

/**
 * Вікно календаря на місяць уперед. Беремо з запасом: сценарії бронюють
 * десятки слотів, і вузьке вікно вичерпалось би на середині прогону.
 */
export function calendarWindow() {
  const from = new Date(Date.now() + 86_400_000);
  const to = new Date(Date.now() + 30 * 86_400_000);
  return `from=${from.toISOString()}&to=${to.toISOString()}`;
}

/** Ідентифікатори вільних слотів у вікні — те, що сценарії бронюватимуть. */
export function freeSlots(token) {
  const res = http.get(`${BASE}/api/slots?${calendarWindow()}`, auth(token));
  if (res.status !== 200) throw new Error(`календар не читається: ${res.status}`);
  return res.json().filter((s) => s.state === 'free').map((s) => s.id);
}

/**
 * Поповнити баланс студента так, щоб бронювання йшло ПОВНИМ шляхом:
 * захоплення слота плюс списання коштів в одній транзакції. Без коштів слот
 * ставав би `pre_booked`, і найцікавіша частина критичного шляху — рух грошей —
 * у замір не потрапила б.
 */
export function topUp(teacherToken, studentId, amountMinor = 100_000_000) {
  const res = http.post(
    `${BASE}/api/teacher/students/${studentId}/topup`,
    JSON.stringify({ amountMinor, comment: 'k6' }),
    authJson(teacherToken),
  );
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`поповнення не вдалося: ${res.status} ${res.body}`);
  }
}

export const STUDENTS = [
  'anya@tutorflow.local',
  'bohdan@tutorflow.local',
  'vira@tutorflow.local',
];

export const TEACHER = 'teacher@tutorflow.local';
