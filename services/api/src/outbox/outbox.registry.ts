import { Injectable, Logger } from '@nestjs/common';
import type { OutboxKind } from '@tutorflow/contracts';
import type { OutboxHandler, OutboxHandlers } from './outbox.drain.js';

/**
 * Хто в ЦЬОМУ сервісі вміє доставляти завдання якого виду.
 *
 * Реєстр заповнюється при старті процесу, а не впорскуванням, і причина
 * практична: обробник списання кличе сервіс розкладу, сервіс розкладу
 * залежить від дренажу журналу, а дренаж — від обробників. Коло залежностей
 * розривається саме тут: дренаж знає реєстр, а не обробників, і реєстр
 * наповнюється одним рядком у точці входу — там, де й видно, який це сервіс.
 */
@Injectable()
export class OutboxRegistry {
  private readonly log = new Logger('Outbox');
  private handlers: OutboxHandlers = {};

  register(handlers: OutboxHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
    this.log.log(`доставляю завдання: ${Object.keys(this.handlers).join(', ') || '(жодних)'}`);
  }

  for(kind: string): OutboxHandler | undefined {
    return this.handlers[kind as OutboxKind];
  }
}
