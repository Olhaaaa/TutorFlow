import { Injectable, Logger } from '@nestjs/common';
import type { OutboxKind, OutboxOutcome } from '@tutorflow/contracts';
import { OutboxRegistry } from './outbox.registry.js';
import { OutboxRepository, type ClaimedJob } from './outbox.repository.js';
import type { OutboxFlush } from './flush.js';

/**
 * Хто вміє доставити завдання певного виду.
 *
 * `deliver` віддає не true/false, а один із трьох станів, бо лікуються вони
 * по-різному. `done` — підтверджено. `retry` — сусід не відповів, пробуємо
 * пізніше; саме завдяки цьому стану нічого не губиться. `compensate` — сусід
 * ВІДМОВИВ назавжди, і повторювати немає сенсу: натомість треба відкотити
 * наслідок у власній базі, для чого й існує другий метод.
 */
export interface OutboxHandler {
  deliver(payload: unknown): Promise<OutboxOutcome>;
  /** Відкотити власний наслідок, якщо сусід відмовив назавжди. */
  compensate?(payload: unknown): Promise<void>;
}

export type OutboxHandlers = Partial<Record<OutboxKind, OutboxHandler>>;

/** Скільки завдань брати за один прохід. Пачка, щоб не ходити в базу по одному. */
const BATCH = 25;

/**
 * Дренаж журналу: доставляє те, що лишили коміти.
 *
 * Той самий клас працює у двох режимах. `flush()` — один прохід, викликається
 * одразу після коміту тим процесом, який цей коміт зробив: так студент бачить
 * результат відразу, а не за секунду. `run()` — цикл у воркері, який забирає
 * все, що не доїхало з першої спроби: саме він і є гарантією доставки.
 *
 * Завдання одного студента доставляються СТРОГО по порядку. Якщо ранішнє не
 * доїхало, пізніші того самого студента в цьому проході пропускаються —
 * інакше перенесення заняття застосувалось би списанням уперед повернення, і
 * студент побачив би борг, якого немає. Для інших студентів прохід триває.
 */
@Injectable()
export class OutboxDrain implements OutboxFlush {
  private readonly log = new Logger('Outbox');
  private running = false;

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly registry: OutboxRegistry,
  ) {}

  /**
   * Один прохід. Ніколи не кидає виняток: завдання вже в базі, і доля
   * доставки не повинна ламати відповідь користувачу.
   *
   * @returns скільком завданням доставка вдалась.
   */
  async flush(): Promise<void> {
    await this.pass();
  }

  async pass(): Promise<number> {
    // Два одночасні проходи в одному процесі нічого не зламали б, але робили б
    // подвійну роботу: обидва взяли б різні пачки й пішли б у сусіда разом.
    if (this.running) return 0;
    this.running = true;

    try {
      const jobs = await this.outbox.claim(BATCH);
      const blocked = new Set<number>();
      let delivered = 0;

      for (const job of jobs) {
        const student = studentOf(job.payload);
        if (student !== null && blocked.has(student)) continue;

        const outcome = await this.handle(job);
        if (outcome === 'done') delivered += 1;
        else if (outcome === 'retry' && student !== null) blocked.add(student);
      }

      return delivered;
    } catch (e) {
      this.log.error(`прохід не вдався: ${message(e)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** Цикл для воркера. Інтервал — крок перевірки, а не частота доставки. */
  async run(stopping: () => boolean, intervalMs: number): Promise<void> {
    this.log.log(`дренаж журналу кожні ${intervalMs} мс`);

    while (!stopping()) {
      const delivered = await this.pass();
      if (delivered > 0) this.log.log(`доставлено завдань: ${delivered}`);
      // Якщо щось доставили, одразу пробуємо ще: під навантаженням пачка
      // майже завжди повна, і чекати інтервал означало б накопичувати чергу.
      if (delivered === 0) await sleep(intervalMs);
    }
  }

  private async handle(job: ClaimedJob): Promise<OutboxOutcome> {
    const handler = this.registry.for(job.kind);

    if (!handler) {
      // Сервіс не вміє доставляти цей вид — і це помилка конфігурації, а не
      // стан системи. Рядок лишається невиконаним, і видно його в журналі.
      await this.outbox.noteError(job.id, `немає обробника для «${job.kind}»`);
      this.log.error(`завдання ${job.id}: немає обробника для «${job.kind}»`);
      return 'retry';
    }

    let outcome: OutboxOutcome;
    try {
      outcome = await handler.deliver(job.payload);
    } catch (e) {
      await this.outbox.noteError(job.id, message(e));
      this.log.warn(`завдання ${job.id} (${job.kind}), спроба ${job.attempts}: ${message(e)}`);
      return 'retry';
    }

    if (outcome === 'retry') {
      await this.outbox.noteError(job.id, 'сусід не підтвердив');
      return 'retry';
    }

    if (outcome === 'compensate') {
      // Відмова назавжди. Завдання закривається — повторювати його немає за
      // чим, — але наслідок у власній базі треба відкотити, і зробити це
      // мусить той, хто його створив.
      this.log.warn(`завдання ${job.id} (${job.kind}): відмова, компенсую`);
      try {
        await handler.compensate?.(job.payload);
        await this.outbox.markDelivered(job.id);
        await this.outbox.noteError(job.id, 'відмова сусіда, наслідок скомпенсовано');
      } catch (e) {
        // Компенсація не вдалась — рядок лишається, і наступна спроба
        // повторить саму компенсацію. Повторна компенсація безпечна: вона
        // теж UPDATE з умовою на поточний стан.
        await this.outbox.noteError(job.id, `компенсація не вдалась: ${message(e)}`);
        return 'retry';
      }
      return 'compensate';
    }

    await this.outbox.markDelivered(job.id);
    return 'done';
  }
}

/**
 * Якого студента стосується завдання. Потрібно лише для порядку доставки,
 * тому незнайомий вигляд тіла — не помилка, а просто «порядок не важить».
 */
function studentOf(payload: unknown): number | null {
  if (payload && typeof payload === 'object' && 'studentId' in payload) {
    const id = (payload as { studentId: unknown }).studentId;
    if (typeof id === 'number') return id;
  }
  return null;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
