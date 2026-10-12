/**
 * Події домену й те, що з них видно назовні.
 *
 * Подія — це ФАКТ, який уже стався і вже зафіксований у базі, а не прохання
 * щось зробити. Звідси два правила, яких тут дотримано. Перше: минулий час у
 * назві (`payment.credited`, а не `credit.payment`) — виконавець не може
 * «відмовити» події. Друге: у події лежить усе, що потрібно споживачеві, щоб
 * не бігати по базу за подробицями, і жодних секретів — стрім читає кожен, хто
 * має доступ до Redis.
 *
 * Файл чистий: ні Nest, ні Redis, ні бази. Тому і типи, і ключ дедуплікації, і
 * текст нагадування перевіряються тестом без жодної інфраструктури.
 */

/** Один стрім на всі події. Розділяти його за типами немає за чим: споживач один. */
export const EVENTS_STREAM = 'tutorflow.events';

/** Кошти зараховані — поповненням викладача або оплатою карткою. */
export interface PaymentCreditedEvent {
  type: 'payment.credited';
  paymentId: number;
  studentId: number;
  amountMinor: number;
  balanceMinor: number;
  /** Заняття, які це зарахування закрило. */
  convertedSlots: number[];
}

/** Викладач скасував заняття; якщо воно було оплачене — кошти вже повернуті. */
export interface LessonCancelledByTeacherEvent {
  type: 'lesson.cancelled_by_teacher';
  slotId: number;
  studentId: number;
  /** ISO 8601 в UTC: у текст нагадування час переводить канал доставки. */
  startAt: string;
  refundedMinor: number;
}

/** Заняття вже скоро — нагадування за добу. */
export interface LessonUpcomingEvent {
  type: 'lesson.upcoming';
  slotId: number;
  studentId: number;
  startAt: string;
  /** Чи заняття вже оплачене: від цього залежить, про що нагадувати. */
  paid: boolean;
}

/** Строк оплати закріпленого заняття спливає. */
export interface PaymentDueEvent {
  type: 'payment.due';
  slotId: number;
  studentId: number;
  startAt: string;
  /** Момент, після якого закріплення звільняється. */
  payBy: string;
  priceMinor: number;
}

export type DomainEvent =
  | PaymentCreditedEvent
  | LessonCancelledByTeacherEvent
  | LessonUpcomingEvent
  | PaymentDueEvent;

/**
 * Ключ, за яким споживач розпізнає ПОВТОРНУ доставку тієї самої події.
 *
 * Redis Streams дає at-least-once: якщо споживач упав між обробкою й `XACK`,
 * повідомлення повернеться. Тому ключ будується з того, що однозначно
 * ідентифікує факт у нашій базі, а НЕ з ідентифікатора повідомлення в стрімі:
 * у повторної доставки той самий id, але в події, опублікованої двічі через
 * повторний вебхук, id був би різний — а факт той самий.
 */
export function dedupKey(event: DomainEvent): string {
  switch (event.type) {
    case 'payment.credited':
      return `payment.credited:${event.paymentId}`;
    case 'lesson.cancelled_by_teacher':
      return `lesson.cancelled_by_teacher:${event.slotId}`;
    // Нагадування про одне заняття надсилається РАЗ, тому ключ — сам слот.
    // Саме це робить прохід воркера безпечним: він публікує подію кілька разів
    // поспіль, а нагадування лишається одне.
    case 'lesson.upcoming':
      return `lesson.upcoming:${event.slotId}`;
    case 'payment.due':
      return `payment.due:${event.slotId}`;
  }
}

export interface RenderedNotification {
  studentId: number;
  kind: DomainEvent['type'];
  text: string;
}

const money = (minor: number): string => `${Math.trunc(minor / 100)} ₴`;

/**
 * Текст нагадування. Чиста функція, бо текст — це домен, а не канал: той самий
 * рядок піде і в Telegram, і в лог, і в майбутню пошту.
 *
 * Час заняття у текст НЕ підставляється: він має бути в зоні СТУДЕНТА, а зона
 * живе в його профілі. Переводить його канал доставки, маючи `startAt` із
 * події.
 */
export function renderNotification(event: DomainEvent): RenderedNotification {
  switch (event.type) {
    case 'payment.credited': {
      const closed = event.convertedSlots.length;
      const tail = closed > 0
        ? ` Закрито занять: ${closed}.`
        : '';
      return {
        studentId: event.studentId,
        kind: event.type,
        text: `Зараховано ${money(event.amountMinor)}.${tail} `
          + `На балансі ${money(event.balanceMinor)}.`,
      };
    }
    case 'lesson.cancelled_by_teacher':
      return {
        studentId: event.studentId,
        kind: event.type,
        text: event.refundedMinor > 0
          ? `Викладач скасував заняття. ${money(event.refundedMinor)} повернуто на баланс.`
          : 'Викладач скасував заняття. Воно не було оплачене, тому кошти не рухались.',
      };
    case 'lesson.upcoming':
      return {
        studentId: event.studentId,
        kind: event.type,
        text: event.paid
          ? 'Нагадування: заняття завтра.'
          : 'Нагадування: заняття завтра, і воно ще не оплачене.',
      };
    case 'payment.due':
      return {
        studentId: event.studentId,
        kind: event.type,
        text: `Заняття коштує ${money(event.priceMinor)} і ще не оплачене. `
          + 'Якщо не оплатити до кінця строку, місце звільниться.',
      };
  }
}
