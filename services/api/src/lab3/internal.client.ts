import { Injectable, Logger } from '@nestjs/common';
import { INSUFFICIENT_FUNDS, INTERNAL_TOKEN_HEADER } from '@tutorflow/contracts';
import { lab3, peerUrl } from './config.js';

/**
 * Сусід не відповів: мережа, таймаут або 5xx.
 *
 * Це стан, який ЛІКУЄТЬСЯ ПОВТОРОМ, і саме тому він окремий тип. Завдання з
 * журналу при такій помилці не закривається, і наступна спроба зробить те
 * саме — рано чи пізно вдало.
 */
export class PeerUnavailableError extends Error {
  constructor(peer: string, reason: string) {
    super(`сервіс ${peer} не відповів: ${reason}`);
    this.name = 'PeerUnavailableError';
  }
}

/**
 * Сусід відмовив ПО СУТІ: 4xx.
 *
 * Повторювати немає сенсу — відповідь буде та сама. Якщо ця відмова лишає
 * наслідок у нашій базі, його треба компенсувати, і для цього в помилці є
 * код: `insufficient_funds` означає «гроші не списались, заняття мусить
 * повернутись у неоплачене».
 */
export class PeerRejectedError extends Error {
  constructor(peer: string, readonly status: number, readonly code: string | null, detail: string) {
    super(`сервіс ${peer} відмовив (${status}): ${detail}`);
    this.name = 'PeerRejectedError';
  }

  get insufficientFunds(): boolean {
    return this.code === INSUFFICIENT_FUNDS;
  }
}

type Peer = 'identity' | 'scheduling' | 'billing' | 'notifications';

/**
 * Клієнт внутрішніх викликів.
 *
 * Це рівно те, чим у моноліті був виклик методу через порт — плюс усе, що
 * мережа додає від себе: таймаут, серіалізація, два види помилок і
 * необхідність вирішувати, чи повторювати. Саме ця різниця й є ціною поділу, і
 * вона тут зібрана в одному файлі, щоб її було видно цілком, а не розмазано
 * по адаптерах.
 *
 * Повторів усередині НЕМА навмисно. Той, хто кличе, краще знає, чи можна
 * повторювати: читання балансу повторювати безглуздо (запрос користувача вже
 * чекає), а доставку списання — обовʼязково, і робить це дренаж журналу зі
 * своєю витримкою.
 */
@Injectable()
export class InternalClient {
  private readonly log = new Logger('Internal');

  get<T>(peer: Peer, path: string): Promise<T> {
    return this.send<T>(peer, path, 'GET');
  }

  post<T>(peer: Peer, path: string, body?: unknown): Promise<T> {
    return this.send<T>(peer, path, 'POST', body);
  }

  private async send<T>(
    peer: Peer,
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
  ): Promise<T> {
    const url = `${peerUrl(peer)}${path}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(lab3.internalToken ? { [INTERNAL_TOKEN_HEADER]: lab3.internalToken } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(lab3.internalTimeoutMs),
      });
    } catch (e) {
      // Сюда потрапляють і таймаут, і відмова в з'єднанні — для викличної
      // сторони це той самий стан: сусіда зараз немає.
      throw new PeerUnavailableError(peer, e instanceof Error ? e.message : String(e));
    }

    if (res.status >= 500) {
      throw new PeerUnavailableError(peer, `${res.status} ${await safeText(res)}`);
    }

    if (!res.ok) {
      const payload = await safeJson(res);
      throw new PeerRejectedError(peer, res.status, codeOf(payload), detailOf(payload));
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

/** Код відмови, якщо сусід його назвав. Текст повідомлення для цього не годиться. */
function codeOf(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'code' in payload) {
    const code = (payload as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

function detailOf(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const m = (payload as { message?: unknown }).message;
    if (typeof m === 'string') return m;
    if (Array.isArray(m)) return m.join('; ');
  }
  return JSON.stringify(payload);
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return { message: res.statusText };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return res.statusText;
  }
}
