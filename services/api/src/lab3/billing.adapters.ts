import { Injectable } from '@nestjs/common';
import type { PendingLessons } from '@tutorflow/contracts';
import type { Executor } from '../db/database.module.js';
import type { LessonsPort, NewStudentSink } from '../billing/ports.js';
import { OutboxRepository } from '../outbox/outbox.repository.js';
import { InternalClient } from './internal.client.js';
import { newOpId } from './op-id.js';

/**
 * LessonsPort через межу процесів.
 *
 * Два методи — і два різні способи, бо вони різні за природою.
 *
 * **Читання неоплачених занять** — звичайний запрос по HTTP. Користувач чекає
 * відповіді, тому ходимо синхронно, а транзакцію ігноруємо: дані чужі.
 *
 * **Закриття занять після поповнення** — ТІЛЬКИ через журнал, і це не вибір
 * стилю, а вимушене рішення. Пояснення в коментарі до `applyPayment`.
 */
@Injectable()
export class LessonsOverHttp implements LessonsPort {
  constructor(
    private readonly internal: InternalClient,
    private readonly outbox: OutboxRepository,
  ) {}

  async pendingPayment(studentId: number, _tx?: Executor) {
    const res = await this.internal.get<PendingLessons>(
      'scheduling', `/internal/students/${studentId}/pending-lessons`,
    );
    return res.lessons;
  }

  /**
   * Закрити неоплачені заняття коштами, які щойно надійшли.
   *
   * Повертає ПОРОЖНІЙ список, і це не недоробка. Закликати розклад просто
   * зараз неможливо: ми всередині транзакції, яка вже зсунула баланс, тобто
   * тримає замок на рядку студента. Розклад у відповідь на «закрий заняття»
   * пішов би списувати за них кошти — у той самий рядок, — і дочекався б
   * зняття замка, якого не буде, бо наша транзакція чекає його відповіді.
   * Взаємне блокування через два процеси: обидва живі, обидва чекають.
   *
   * Тому в транзакції лишається тільки завдання, а виклик іде ПІСЛЯ коміту —
   * тим самим `flush()`, що й усі інші. Ціна: відповідь на поповнення більше
   * не містить переліку закритих занять, бо на момент відповіді їх ще не
   * закрито. Кабінет показує їх після перечитування балансу — секундою
   * пізніше. Це і є eventual consistency там, де в моноліті була одна
   * транзакція.
   */
  async applyPayment(tx: Executor, studentId: number): Promise<number[]> {
    const opId = newOpId();
    await this.outbox.add(
      { kind: 'scheduling.apply_payment', payload: { opId, studentId } },
      opId,
      tx,
    );
    return [];
  }
}

/**
 * Розсилка факту «зʼявився студент» двом сервісам, яким він потрібен.
 *
 * Обидва завдання пишуться транзакцією, яка створює студента. Через це
 * неможлива ситуація, коли студент у базі є, а увійти не може й нагадувань не
 * отримує: або створені всі три записи, або жодного.
 *
 * Хеш пароля їде в завданні, бо господар реквізитів входу — сервіс входу, і
 * саме він мусить його мати. Журнал outbox лежить у власній базі й назовні не
 * світиться, тому носити хеш у ньому не гірше, ніж тримати в таблиці.
 */
@Injectable()
export class NewStudentFanout implements NewStudentSink {
  constructor(private readonly outbox: OutboxRepository) {}

  async created(
    tx: Executor,
    student: {
      id: number; teacherId: number; name: string;
      email: string; passwordHash: string; timezone: string;
    },
  ): Promise<void> {
    await this.outbox.add(
      {
        kind: 'identity.credential',
        payload: {
          id: student.id,
          role: 'student',
          email: student.email,
          passwordHash: student.passwordHash,
          name: student.name,
          timezone: student.timezone,
          teacherId: student.teacherId,
        },
      },
      null,
      tx,
    );

    await this.outbox.add(
      {
        kind: 'notifications.contact',
        payload: {
          studentId: student.id,
          name: student.name,
          timezone: student.timezone,
          telegramChatId: null,
          telegramLinkCode: null,
        },
      },
      null,
      tx,
    );
  }
}
