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
import { returnUrl, webhookUrl } from './urls.js';
import { EventBus } from '../events/event-bus.js';

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

/**
 * Нижня межа поповнення — 1 ₴.
 *
 * Знижена до мінімуму провайдера свідомо: на тестовому токені рахунок на
 * 100 ₴ незручно проганяти десятки разів, а межа тут захищає не від малих
 * сум, а від безглуздих — рахунок на одну копійку провайдер однаково не
 * прийме, зате комісію за звернення візьме.
 *
 * Для бойового розгортання її варто підняти до розумної частки ціни заняття:
 * кожен платіж коштує грошей незалежно від суми.
 */
const MIN_AMOUNT_MINOR = 100;

/** Рядок платежу як його віддає сховище. Другого опису тих самих полів не треба. */
type PaymentRow = NonNullable<Awaited<ReturnType<PaymentsRepository['byId']>>>;

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(KYSELY) private readonly db: Database,
    private readonly payments: PaymentsRepository,
    private readonly billing: BillingService,
    private readonly mono: MonobankClient,
    private readonly teachers: TeachersRepository,
    private readonly cipher: TokenCipher,
    private readonly events: EventBus,
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
      /**
       * Зовнішня адреса застосунку й доля вебхука при ній. Це стан
       * РОЗГОРТАННЯ, а не рахунку, але бачити його мусить той, хто
       * налаштовує оплату: інакше про проблему дізнається студент — у
       * вигляді помилки при спробі заплатити.
       */
      publicBaseUrl: config.publicBaseUrl,
      webhookUrl: webhookUrl(config.publicBaseUrl),
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

    const payment = await this.payments.create({
      studentId,
      teacherId,
      provider: 'monobank',
      amountMinor,
    });

    // Відсутність публічної адреси не є приводом відмовити в оплаті: без
    // вебхука платіж усе одно проходить, а статус добирається опитуванням —
    // див. reconcile. Саме це робить оплату перевірюваною на локальній машині.
    const invoice = await this.mono.createInvoice({
      token,
      amountMinor,
      reference: String(payment.id),
      destination: 'Поповнення балансу Tutorflow',
      webHookUrl: webhookUrl(config.publicBaseUrl),
      redirectUrl: returnUrl(config.publicBaseUrl, payment.id),
    });

    const saved = await this.payments.attachInvoice(payment.id, invoice.invoiceId, invoice.pageUrl);

    return { id: saved.id, amountMinor, pageUrl: invoice.pageUrl, status: saved.status };
  }

  /**
   * Статус для сторінки повернення. Чужі платежі не показуємо.
   *
   * Поки платіж висить `pending`, статус добирається у провайдера. Сторінка
   * повернення опитує цей маршрут кожні дві секунди, тому окремого «оновити»
   * користувачу не потрібно.
   */
  async byId(studentId: number, paymentId: number) {
    const p = await this.payments.byId(paymentId);
    if (!p) throw new NotFoundException('платіж не знайдено');
    if (p.student_id !== studentId) throw new ForbiddenException('це не ваш платіж');

    const fresh = p.status === 'pending' && p.provider_payment_id ? await this.reconcile(p) : p;

    return {
      id: fresh.id,
      amountMinor: fresh.amount_minor,
      status: fresh.status,
      pageUrl: fresh.page_url,
    };
  }

  /**
   * Добір статусу в провайдера для платежу, що висить `pending`.
   *
   * Вебхук губиться регулярно й з різних причин: локальна машина без
   * публічної адреси, тунель відвалився, процес саме перезапускався,
   * провайдер не дочекався 2xx. Гроші з картки при цьому вже списані, тому
   * єдине правильне — спитати провайдера самим.
   *
   * Зарахування йде ТИМ САМИМ шляхом, що й у вебхука, тому одночасні добір і
   * доставка не подвоять коштів: виграє той, хто перший зробить
   * `UPDATE … WHERE status <> 'paid'`.
   *
   * Помилка провайдера назовні не піднімається: статус із нашої бази — усе
   * одно коректна відповідь, а падіння зробило б сторінку повернення
   * непрацездатною через чужу недоступність.
   */
  private async reconcile(payment: PaymentRow): Promise<PaymentRow> {
    const invoiceId = payment.provider_payment_id;
    if (!invoiceId) return payment;

    try {
      const token = await this.tokenFor(payment.teacher_id ?? 0);
      const invoice = await this.mono.status(token, invoiceId);
      const mapped = STATUS[invoice.status];

      // проміжний стан — рахунок ще в роботі, нічого не змінюємо
      if (!mapped || mapped === 'pending') return payment;

      if (mapped === 'paid') {
        await this.creditInvoice(payment, invoiceId, invoice);
      } else {
        await this.payments.markStatus({
          provider: 'monobank',
          providerPaymentId: invoiceId,
          status: mapped,
          raw: invoice,
        });
      }

      return (await this.payments.byId(payment.id)) ?? payment;
    } catch (e) {
      console.warn(
        `платіж ${payment.id}: добір статусу не вдався — ${e instanceof Error ? e.message : String(e)}`,
      );
      return payment;
    }
  }

  /**
   * Зарахувати оплачений рахунок. Спільне для вебхука й для добору статусу:
   * обидва шляхи мусять зараховувати кошти однаково й рівно раз, тому логіка
   * одна, а не дві схожі.
   */
  private async creditInvoice(
    payment: Pick<PaymentRow, 'id' | 'student_id' | 'amount_minor'>,
    invoiceId: string,
    raw: unknown,
  ) {
    const result = await this.db
      .transaction()
      .execute(async (tx) => {
        const credited = await this.billing.credit(
          tx,
          payment.student_id,
          payment.amount_minor,
          `оплата monobank ${invoiceId}`,
        );

        const claimed = await this.payments.markPaid(
          {
            provider: 'monobank',
            providerPaymentId: invoiceId,
            transactionId: credited.transactionId,
            raw,
          },
          tx,
        );

        // Рядок уже був оплачений — цей виклик повторний. Відкочуємо
        // транзакцію цілком, тому проводка, створена кілька рядків вище, теж
        // зникає.
        if (!claimed) throw new AlreadyCredited();

        return {
          credited: true as const,
          status: 'paid' as const,
          balanceMinor: credited.balanceMinor,
          convertedSlots: credited.convertedSlots,
        };
      })
      .catch((e: unknown) => {
        if (e instanceof AlreadyCredited) {
          return { credited: false as const, status: 'paid' as const, reason: 'повторна доставка' };
        }
        throw e;
      });

    // Подія публікується ПІСЛЯ коміту й лише якщо кошти справді зарахувала ця
    // спроба. Опублікувати її всередині транзакції означало б пообіцяти факт,
    // який ще може відкотитись; опублікувати при повторній доставці — надіслати
    // студентові друге нагадування про те саме.
    if (result.credited) {
      await this.events.publish({
        type: 'payment.credited',
        paymentId: payment.id,
        studentId: payment.student_id,
        amountMinor: payment.amount_minor,
        balanceMinor: result.balanceMinor,
        convertedSlots: result.convertedSlots,
      });
    }

    return result;
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

    return this.creditInvoice(payment, body.invoiceId, body);
  }
}

/** Внутрішній сигнал відкоту, назовні не виходить. */
class AlreadyCredited extends Error {}
