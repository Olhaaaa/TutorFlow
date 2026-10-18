/**
 * Виконувана специфікація ДОСТАВКИ між сервісами.
 *
 * У моноліті цього файлу не було б потреби: там бронювання й списання — одна
 * транзакція, і гарантію дає база. Коли в кожного сервіса власна база,
 * гарантію дає цей механізм, і перевіряти його треба так само серйозно, як
 * раніше перевірялась атомарність слота.
 *
 * Тест інтеграційний, бо весь зміст — у SQL: захоплення пачки з `for update
 * skip locked`, витримка, яка ставиться тим самим запросом, і те, що рядок,
 * узятий у роботу, не можна взяти вдруге. У коді це виглядало б правильно за
 * будь-якої реалізації.
 *
 * Потрібна піднята локальна база: docker compose -f compose.dev.yml up -d
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/database.module.js';
import { OutboxDrain, type OutboxHandlers } from '../src/outbox/outbox.drain.js';
import { OutboxRegistry } from '../src/outbox/outbox.registry.js';
import { OutboxRepository } from '../src/outbox/outbox.repository.js';

const db = createDatabase();
const outbox = new OutboxRepository(db);

const transfer = (studentId: number, slotId: number, opId: string) => ({
  kind: 'billing.charge' as const,
  payload: { opId, studentId, slotId, amountMinor: 50_000 },
});

/** Дренаж із підставними обробниками: межа тут не перевіряється, перевіряється механіка. */
function drainWith(handlers: OutboxHandlers): OutboxDrain {
  const registry = new OutboxRegistry();
  registry.register(handlers);
  return new OutboxDrain(outbox, registry);
}

async function rows() {
  return db
    .selectFrom('outbox')
    .select(['id', 'kind', 'attempts', 'delivered_at', 'last_error'])
    .orderBy('id')
    .execute();
}

beforeEach(async () => {
  await db.deleteFrom('outbox').execute();
});

afterAll(async () => {
  await db.deleteFrom('outbox').execute();
  await db.destroy();
});

describe('журнал відкладених доставок', () => {
  it('завдання, узяте в роботу, одразу відкладене на наступну спробу', async () => {
    await outbox.add(transfer(1, 10, 'op-1'));

    const first = await outbox.claim(10);
    expect(first).toHaveLength(1);
    expect(first[0]!.attempts).toBe(1);

    // Другий дренаж у ту саму мить не має брати те саме завдання: витримка
    // ставиться тим самим запросом, що й захоплення. Без цього два процеси
    // ходили б до сусіда з одним і тим самим списанням.
    expect(await outbox.claim(10)).toHaveLength(0);
  });

  it('доставлене завдання більше не повертається', async () => {
    await outbox.add(transfer(1, 10, 'op-2'));
    const delivered = await drainWith({
      'billing.charge': { deliver: async () => 'done' },
    }).pass();

    expect(delivered).toBe(1);
    const [row] = await rows();
    expect(row!.delivered_at).not.toBeNull();
    expect(await outbox.claim(10)).toHaveLength(0);
  });

  it('виняток у доставці лишає завдання в журналі зі слідом причини', async () => {
    await outbox.add(transfer(1, 10, 'op-3'));
    const delivered = await drainWith({
      'billing.charge': {
        deliver: async () => { throw new Error('сусід не відповів'); },
      },
    }).pass();

    expect(delivered).toBe(0);
    const [row] = await rows();
    expect(row!.delivered_at).toBeNull();
    expect(row!.attempts).toBe(1);
    expect(row!.last_error).toContain('сусід не відповів');
  });

  /**
   * Відмова по суті лікується не повтором, а компенсацією: сусід сказав «ні»
   * назавжди, тому наслідок у власній базі треба відкотити, а завдання —
   * закрити.
   */
  it('відмова сусіда компенсується й завдання закривається', async () => {
    await outbox.add(transfer(7, 42, 'op-4'));
    const compensated: number[] = [];

    await drainWith({
      'billing.charge': {
        deliver: async () => 'compensate',
        compensate: async (payload) => {
          compensated.push((payload as { slotId: number }).slotId);
        },
      },
    }).pass();

    expect(compensated).toEqual([42]);
    const [row] = await rows();
    expect(row!.delivered_at).not.toBeNull();
    expect(row!.last_error).toContain('скомпенсовано');
  });

  it('невдала компенсація лишає завдання, щоб повторити саму компенсацію', async () => {
    await outbox.add(transfer(7, 42, 'op-5'));

    await drainWith({
      'billing.charge': {
        deliver: async () => 'compensate',
        compensate: async () => { throw new Error('база недоступна'); },
      },
    }).pass();

    const [row] = await rows();
    expect(row!.delivered_at).toBeNull();
    expect(row!.last_error).toContain('компенсація не вдалась');
  });

  /**
   * ПОРЯДОК. Перенесення заняття записує повернення й списання двома рядками,
   * і застосувати їх навпаки означало б показати студентові борг, якого
   * немає. Тому завдання одного студента, що стоять після невдалого,
   * у цьому проході не чіпаються.
   */
  it('після невдачі наступні завдання того самого студента не йдуть', async () => {
    await outbox.add(transfer(1, 10, 'op-6'));   // це не доїде
    await outbox.add(transfer(1, 11, 'op-7'));   // це мусить дочекатись
    await outbox.add(transfer(2, 12, 'op-8'));   // інший студент — має доїхати

    const attempted: string[] = [];
    await drainWith({
      'billing.charge': {
        deliver: async (payload) => {
          const p = payload as { opId: string; studentId: number };
          attempted.push(p.opId);
          if (p.opId === 'op-6') throw new Error('сусід не відповів');
          return 'done';
        },
      },
    }).pass();

    expect(attempted).toEqual(['op-6', 'op-8']);

    const all = await rows();
    expect(all.map((r) => r.delivered_at !== null)).toEqual([false, false, true]);
    // op-7 не пробували взагалі: сліду причини в нього немає.
    expect(all[1]!.last_error).toBeNull();
  });

  it('вид завдання без обробника — помилка конфігурації, видна в журналі', async () => {
    await outbox.add(transfer(1, 10, 'op-9'));
    await drainWith({}).pass();

    const [row] = await rows();
    expect(row!.delivered_at).toBeNull();
    expect(row!.last_error).toContain('немає обробника');
  });

  it('невиконані завдання видно числом — це показник здоровʼя межі', async () => {
    expect(await outbox.pendingCount()).toBe(0);
    await outbox.add(transfer(1, 10, 'op-10'));
    await outbox.add(transfer(1, 11, 'op-11'));
    expect(await outbox.pendingCount()).toBe(2);

    await drainWith({ 'billing.charge': { deliver: async () => 'done' } }).pass();
    expect(await outbox.pendingCount()).toBe(0);
  });
});
