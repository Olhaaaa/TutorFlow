import { randomBytes } from 'node:crypto';

/**
 * Код привʼязки чату. Чиста частина каналу: вона не знає ні про HTTP, ні про
 * базу, тому перевіряється тестом без інфраструктури.
 *
 * Привʼязка потрібна через те, як працює Telegram: бот не може почати розмову
 * першим. Доки студент сам не написав боту, його `chat_id` нам невідомий —
 * отже студент мусить принести щось, що звʼяже його чат із рядком у базі.
 *
 * Чому код, а не номер телефону: номер — персональні дані, які нам не потрібні
 * ні для чого іншого, а підтверджувати його довелось би окремо. Код живе лише
 * до першої привʼязки й нічого не означає поза нашою базою.
 */

/**
 * Алфавіт без `0`, `O`, `1`, `I` і `L`: код диктують уголос і переписують з
 * екрана телефону, тому пари, які неможливо розрізнити, виключені.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 8;

/**
 * Новий код. 8 символів із 31 — близько 10^12 варіантів, тобто вгадати
 * чужий код перебором через бота нереально, а колізія при вставці однаково
 * впаде на `unique` і код просто перегенерується.
 */
export function newLinkCode(): string {
  // rejection sampling: `% ALPHABET.length` зробив би перші символи алфавіту
  // частішими за решту. Для коду привʼязки це не катастрофа, але й робити
  // нерівномірність власними руками немає за чим.
  const out: string[] = [];
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < LENGTH) {
    for (const byte of randomBytes(LENGTH)) {
      if (byte >= limit) continue;
      out.push(ALPHABET[byte % ALPHABET.length]!);
      if (out.length === LENGTH) break;
    }
  }
  return out.join('');
}

/**
 * Витягти код із того, що студент надіслав боту.
 *
 * Приймаються три форми, бо всі три трапляються: `/start CODE` (так Telegram
 * передає код із посилання `t.me/бот?start=CODE`), просто `CODE` і код,
 * набраний малими літерами чи з пробілами.
 *
 * @returns код у канонічному вигляді або null, якщо це не код.
 */
export function parseLinkCode(text: string | undefined): string | null {
  if (!text) return null;

  const withoutCommand = text.trim().replace(/^\/start\b/i, '');
  const candidate = withoutCommand.replace(/[\s-]/g, '').toUpperCase();

  if (candidate.length !== LENGTH) return null;
  for (const ch of candidate) {
    if (!ALPHABET.includes(ch)) return null;
  }
  return candidate;
}
