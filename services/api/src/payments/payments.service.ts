import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { KYSELY, type Database } from '../db/database.module.js';
import type { PaymentStatusColumn } from '../db/schema.js';
import { BillingService } from '../billing/billing.service.js';
import { config } from '../config.js';
import { MonobankClient, type MonoInvoiceStatus, type MonoWebhook } from './monobank.client.js';
import { PaymentsRepository } from './payments.repository.js';
import { TokenCipher } from './token-cipher.js';
import { TeachersRepository } from '../scheduling/teachers.repository.js';

/** Провайдер говорить про рахунок, ми — про гроші. Переклад одним місцем. */
const STATUS: Record<MonoInvoiceStatus, PaymentStatusColumn> = {
  created: 'pending',
  processing: 'pending',
  hold: 'pending',
  success: 'paid',
  failure: 'failed',
  reversed: 'failed',
  expired: 'expired',
};

/** Нижня межа поповнення: платити 1 копійку безглуздо, а комісію провайдер візьме. */
const MIN_AMOUNT_MINOR = 10_000;

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(KYSELY) private readonly db: Database,
    private readonly payments: PaymentsRepository,
    private readonly billing: BillingService,
    private readonly mono: MonobankClient,
    private readonly teachers: TeachersRepository,
    private readonly cipher: TokenCipher,
  ) {}

  /* ---------- підключення еквайрингу викладачем ---------- */

  /** Стан підключення для вкладки «Оплата». Токен назовні не виходить. */
  async connection(teacherId: number) {
    const row = await this.teachers.paymentCredentials(teacherId);
    const own = row?.payment_provider ?? null;

    return {
      connected: own !== null,
      provider: own,
      connectedAt: row?.payments_connected_at
        ? new Date(row.payments_connected_at).toISOString()
        : null,
      tokenHint: row?.payment_token_encrypted
        ? TokenCipher.hint(this.cipher.decrypt(row.payment_token_encrypted))
        : null,
      /** Чи є запасний токен розгортання — тоді оплата працює й без підключення. */
      fallbackAvailable: this.mono.fallbackToken !== null,
      /** Чи взагалі можна підключати: без ключа шифрування — ні. */
      canConnect: this.cipher.available,
    };
  }

  /**
   * Підключити рахунок. Токен перевіряється у провайдера ДО збереження:
   * інакше викладач дізнався б про помилку лише тоді, коли студент не зміг
   * заплатити.
   */
  async connect(teacherId: number, token: string) {
    if (!this.cipher.available) {
      throw new ServiceUnavailableException(
        'підключення оплати недоступне: не задано PAYMENT_TOKEN_KEY',
      );
    }
    if (!(await this.mono.check(token))) {
      throw new BadRequestException('провайдер не прийняв цей токен');
    }

    await this.teachers.setPaymentCredentials(teacherId, {
      provider: 'monobank',
      encrypted: this.cipher.encrypt(token),
    });

    return this.connection(teacherId);
  }

  async disconnect(teacherId: number) {
    await this.teachers.clearPaymentCredentials(teacherId);
    return this.connection(teacherId);
  }

  /**
   * Чий токен використовувати для рахунків цього викладача.
   *
   * Власний рахунок має пріоритет; запасний токен розгортання лишається для
   * одноосібної установки й для демонстрації. Якщо немає ні того, ні того —
   * це не поломка сервера, а незавершене налаштування викладача, тому 409,
   * а не 503.
   */
  private async tokenFor(teacherId: number): Promise<string> {
    const row = await this.teachers.paymentCredentials(teacherId);
    if (row?.payment_token_encrypted) return this.cipher.decrypt(row.payment_token_encrypted);

    const fallback = this.mono.fallbackToken;
    if (fallback) return fallback;

    throw new ConflictException('викладач ще не підключив приймання оплати');
  }

  /**
   * Створити рахунок на оплату.
   *
   * Порядок дій важливий: спершу рядок у нашій базі, і лише потім звернення до
   * провайдера. Так id платежу стає `reference` рахунку, і навіть якщо відповідь
   * провайдера загубиться в дорозі, платіж не лишиться безіменним — його можна
   * знайти за reference у кабінеті й звірити вручну.
   */
  async create(studentId: number, teacherId: number, amountMinor: number) {
    const token = await this.tokenFor(teacherId);

    if (!Number.isInteger(amountMinor) || amountMinor < MIN_AMOUNT_MINOR) {
      throw new BadRequestException(
        `мінімальна сума поповнення — ${MIN_AMOUNT_MINOR / 100} ₴`,
      );
    }
    if (!config.publicBaseUrl) {
      throw new BadRequestException(
        'не задано PUBLIC_BASE_URL — провайдеру нема куди надсилати вебхук',
      );
    }

    const payment = await this.payments.create({
      studentId,
      teacherId,
      provider: 'monobank',
      amountMinor,
    });

    const invoice = await this.mono.createInvoice({
      token,
      amountMinor,
      reference: String(payment.id),
      destination: 'Поповнення балансу Tutorflow',
      webHookUrl: `${config.publicBaseUrl}/api/payments/monobank/callback`,
      redirectUrl: `${config.publicBaseUrl}/#payment-${payment.id}`,
    });

    const saved = await this.payments.attachInvoice(payment.id, invoice.invoiceId, invoice.pageUrl);

    return { id: saved.id, amountMinor, pageUrl: invoice.pageUrl, status: saved.status };
  }

  /** Статус для сторінки повернення. Чужі платежі не показуємо. */
  async byId(studentId: number, paymentId: number) {
    const p = await this.payments.byId(paymentId);
    if (!p) throw new NotFoundException('платіж не знайдено');
    if (p.student_id !== studentId) throw new ForbiddenException('це не ваш платіж');

    return { id: p.id, amountMinor: p.amount_minor, status: p.status, pageUrl: p.page_url };
  }

  /**
   * Обробка вебхука.
   *
   * Підпис перевіряється ДО розбору тіла: непідписаному запросу не місце в
   * логіці взагалі. Далі все тримається на одному UPDATE … WHERE status <>
   * 'paid': він і визначає, чи саме цей виклик зараховує гроші. Повторна
   * доставка того самого статусу — не помилка, тому відповідаємо 200, інакше
   * провайдер нескінченно повторюватиме.
   */
  async handleWebhook(rawBody: Buffer, signature: string) {
    // Порядок дій на платформі з багатьма мерчантами інакший, ніж з одним:
    // підпис перевіряється ключем ТОГО мерчанта, який виставив рахунок, тому
    // спершу треба знайти платіж. Тіло на цьому кроці ще не має довіри — з
    // нього береться лише непрозорий ідентифікатор для пошуку.
    const body = JSON.parse(rawBody.toString('utf8')) as MonoWebhook;
    const mapped = STATUS[body.status];
    if (!mapped) throw new BadRequestException(`невідомий статус: ${body.status}`);

    const payment = await this.payments.byInvoice('monobank', body.invoiceId);
    if (!payment) throw new NotFoundException('платіж не знайдено');

    const token = await this.tokenFor(payment.teacher_id ?? 0);
    if (!(await this.mono.verify(token, rawBody, signature))) {
      throw new ForbiddenException('підпис вебхука не пройшов перевірку');
    }

    // Швидкий шлях для повторної доставки: не починаємо транзакцію, якої
    // однаково доведеться відкотити. Гарантією лишається не ця перевірка, а
    // UPDATE … WHERE status <> 'paid' нижче — лише він витримує одночасність.
    if (payment.status === 'paid') {
      return { credited: false, status: 'paid' as const, reason: 'повторна доставка' };
    }

    if (mapped !== 'paid') {
      await this.payments.markStatus({
        provider: 'monobank',
        providerPaymentId: body.invoiceId,
        status: mapped,
        raw: body,
      });
      return { credited: false, status: mapped };
    }

    // Сума береться з НАШОГО рядка, а не з тіла вебхука: сума в базі — та, яку
    // ми самі виставили до оплати, і підмінити її ззовні не можна навіть
    // теоретично. Розбіжність із тілом означає проблему й лишається в raw.
    if (body.amount !== payment.amount_minor) {
      console.warn(
        `платіж ${payment.id}: сума провайдера ${body.amount} ≠ виставленій ${payment.amount_minor}`,
      );
    }

    return this.db.transaction().execute(async (tx) => {
      const credited = await this.billing.credit(
        tx,
        payment.student_id,
        payment.amount_minor,
        `оплата monobank ${body.invoiceId}`,
      );

      const claimed = await this.payments.markPaid(
        {
          provider: 'monobank',
          providerPaymentId: body.invoiceId,
          transactionId: credited.transactionId,
          raw: body,
        },
        tx,
      );

      // Рядок уже був оплачений — цей вебхук повторний. Відкочуємо транзакцію
      // цілком, тому проводка, створена кілька рядків вище, теж зникає.
      if (!claimed) throw new AlreadyCredited();

      return {
        credited: true,
        status: 'paid' as const,
        balanceMinor: credited.balanceMinor,
        convertedSlots: credited.convertedSlots,
      };
    }).catch((e: unknown) => {
      if (e instanceof AlreadyCredited) {
        return { credited: false, status: 'paid' as const, reason: 'повторна доставка' };
      }
      throw e;
    });
  }
}

/** Внутрішній сигнал відкоту, назовні не виходить. */
class AlreadyCredited extends Error {}
