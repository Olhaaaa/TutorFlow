/**
 * Дві адреси, які платіж віддає провайдеру, і правило, коли їх можна давати.
 *
 * Вони різні за природою, і це головне тут. `redirectUrl` відкриває БРАУЗЕР
 * користувача, тому `http://localhost:5173` для нього цілком робочий. А на
 * `webHookUrl` приходить САМ провайдер зі свого боку інтернету — і localhost
 * для нього означає його власну машину. Обіцяти йому адресу, куди він не
 * зможе прийти, означало б ховати проблему: рахунок створився б, статус
 * лишився б `pending`, і ніде не було б видно чому.
 *
 * Тому локальна адреса вебхука не надсилається взагалі. Оплата при цьому
 * лишається робочою: статус добирається опитуванням провайдера, коли студент
 * повертається на сторінку повернення.
 */

/** Чи адреса така, що провайдер із зовнішнього інтернету до неї не дійде. */
function isUnreachableFromOutside(host: string): boolean {
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  if (host.startsWith('127.')) return true;
  // приватні діапазони RFC 1918: тунель із такою адресою не існує
  if (host.startsWith('10.') || host.startsWith('192.168.')) return true;
  const m = /^172\.(\d{1,2})\./.exec(host);
  return m !== null && Number(m[1]) >= 16 && Number(m[1]) <= 31;
}

/**
 * Адреса вебхука або null, якщо просити його безглуздо.
 *
 * Вимоги дві: https (провайдер не надсилає результат у відкритий канал) і
 * публічний хост.
 */
export function webhookUrl(baseUrl: string | null): string | null {
  if (!baseUrl) return null;
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:') return null;
  if (isUnreachableFromOutside(base.hostname)) return null;
  return new URL('/api/payments/monobank/callback', base).toString();
}

/**
 * Адреса повернення зі сторінки оплати. Тут підходить будь-яка задана
 * адреса — її відкриває браузер студента, а не провайдер.
 */
export function returnUrl(baseUrl: string | null, paymentId: number): string | null {
  if (!baseUrl) return null;
  try {
    // Хеш, а не шлях: маршрутизація в застосунку на хеші, і саме за
    // #payment-<id> сторінка розуміє, статус якого платежу опитувати.
    return new URL(`/#payment-${paymentId}`, baseUrl).toString();
  } catch {
    return null;
  }
}
