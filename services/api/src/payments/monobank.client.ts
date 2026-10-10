import { createHash, createPublicKey, createVerify } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { config } from '../config.js';

/**
 * Клієнт еквайрингу monobank («Plata by mono»).
 *
 * Межа із зовнішнім світом винесена в окремий клас навмисно: сервіс платежів
 * не повинен знати ні про HTTP, ні про формат підпису. У лабораторній 3, коли
 * білінг стане окремим сервісом, переїде рівно цей файл.
 */

/** Статуси рахунку в monobank. Проміжні теж приходять у вебхуку. */
export type MonoInvoiceStatus =
  | 'created'
  | 'processing'
  | 'hold'
  | 'success'
  | 'failure'
  | 'reversed'
  | 'expired';

export interface MonoWebhook {
  invoiceId: string;
  status: MonoInvoiceStatus;
  amount: number;
  ccy: number;
  finalAmount?: number;
  reference?: string;
  failureReason?: string;
  createdDate?: string;
  modifiedDate?: string;
}

export interface MonoInvoice {
  invoiceId: string;
  pageUrl: string;
}

/** 980 — код гривні за ISO 4217. Інших валют проєкт не знає. */
const UAH = 980;

@Injectable()
export class MonobankClient {
  /**
   * Публічні ключі мерчантів. Ключ видається під конкретний токен, тому на
   * платформі з багатьма викладачами він у кожного свій — кеш за відбитком
   * токена, а не один на процес. У кеші лежить ключ, не токен.
   *
   * Запитувати ключ у провайдера на кожен вебхук означало б поставити
   * зарахування коштів у залежність від його доступності.
   */
  private readonly pubKeys = new Map<string, string>();

  /** Запасний токен розгортання — для викладачів без власного рахунку. */
  get fallbackToken(): string | null {
    return config.monobank.token;
  }

  private async call<T>(token: string, path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${config.monobank.apiBase}${path}`, {
      ...init,
      headers: {
        'X-Token': token,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });

    if (!res.ok) {
      // Текст помилки провайдера віддавати користувачу не можна — у ньому
      // буває внутрішня інформація, тому назовні йде загальне повідомлення.
      const body = await res.text().catch(() => '');
      console.error(`monobank ${path} → ${res.status}: ${body.slice(0, 500)}`);
      throw new ServiceUnavailableException('платіжний провайдер недоступний');
    }

    return (await res.json()) as T;
  }

  /**
   * Створити рахунок. `amountMinor` — копійки: monobank приймає суму саме в
   * них, тому брендований тип грошей проєкту перетинає межу без конвертації.
   */
  createInvoice(params: {
    token: string;
    amountMinor: number;
    reference: string;
    destination: string;
    /** Куди провайдер надішле результат. Null — не просимо вебхука взагалі. */
    webHookUrl?: string | null;
    /** Куди повернути користувача з платіжної сторінки. */
    redirectUrl?: string | null;
    validitySec?: number;
  }): Promise<MonoInvoice> {
    return this.call<MonoInvoice>(params.token, '/api/merchant/invoice/create', {
      method: 'POST',
      body: JSON.stringify({
        amount: params.amountMinor,
        ccy: UAH,
        merchantPaymInfo: {
          reference: params.reference,
          destination: params.destination,
        },
        // Поля, яких немає, саме ВИПУСКАЮТЬСЯ, а не йдуть як null: провайдер
        // розрізняє «вебхук не потрібен» і «ось вам null замість адреси».
        ...(params.webHookUrl ? { webHookUrl: params.webHookUrl } : {}),
        ...(params.redirectUrl ? { redirectUrl: params.redirectUrl } : {}),
        validity: params.validitySec ?? 3600,
        paymentType: 'debit',
      }),
    });
  }

  /** Опитування статусу. Потрібне, якщо вебхук загубився. */
  status(token: string, invoiceId: string): Promise<MonoWebhook> {
    return this.call<MonoWebhook>(
      token,
      `/api/merchant/invoice/status?invoiceId=${encodeURIComponent(invoiceId)}`,
    );
  }

  /**
   * Перевірка токена при підключенні: якщо провайдер віддає ключ — токен
   * справжній і належить мерчанту. Дешевий запрос без побічних наслідків,
   * тому саме він, а не створення пробного рахунку.
   */
  async check(token: string): Promise<boolean> {
    try {
      await this.publicKeyPem(token);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Перевірка підпису вебхука: ECDSA над SHA-256, ключ — NIST P-256.
   *
   * Підписується СИРЕ тіло запросу, байт у байт. Перевіряти підпис над
   * повторно серіалізованим JSON не можна: порядок ключів і пробіли змінюються,
   * і підпис перестане сходитись.
   */
  async verify(token: string, rawBody: Buffer, signatureBase64: string): Promise<boolean> {
    if (!signatureBase64) return false;

    const key = createPublicKey(await this.publicKeyPem(token));
    const verifier = createVerify('SHA256');
    verifier.update(rawBody);
    verifier.end();

    try {
      return verifier.verify(key, Buffer.from(signatureBase64, 'base64'));
    } catch {
      return false; // некоректний формат підпису — це просто «не пройшов»
    }
  }

  private async publicKeyPem(token: string): Promise<string> {
    // Відбиток, а не сам токен: секрети не повинні лежати ключами в мапах,
    // де їх легко побачити в дампі памʼяті чи в дебагері.
    const fingerprint = createHash('sha256').update(token).digest('base64url');
    const cached = this.pubKeys.get(fingerprint);
    if (cached) return cached;

    const { key } = await this.call<{ key: string }>(token, '/api/merchant/pubkey');
    // Провайдер віддає PEM, закодований у base64 поверх самого PEM.
    const pem = Buffer.from(key, 'base64').toString('utf8');
    this.pubKeys.set(fingerprint, pem);
    return pem;
  }
}
