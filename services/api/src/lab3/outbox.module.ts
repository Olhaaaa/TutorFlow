import { Global, Module } from '@nestjs/common';
import { OUTBOX_FLUSH } from '../outbox/flush.js';
import { OutboxDrain } from '../outbox/outbox.drain.js';
import { OutboxRegistry } from '../outbox/outbox.registry.js';
import { OutboxRepository } from '../outbox/outbox.repository.js';
import { InternalClient } from './internal.client.js';

/**
 * Межа доставки в МІКРОСЕРВІСАХ: та сама, що в моноліті, тільки не порожня.
 *
 * Модуль постачає `OUTBOX_FLUSH` справжнім дренажем, тому `flush()` після
 * коміту в доменних сервісах перетворюється з нічого на запрос до сусіда. Ні
 * SchedulingService, ні BillingService про цю заміну не знають — і в цьому вся
 * суть: доменний код в обох архітектурах той самий.
 *
 * Реєстр обробників тут порожній: наповнює його точка входу сервіса, бо саме
 * вона знає, який це сервіс і що він вміє доставляти.
 */
@Global()
@Module({
  providers: [
    InternalClient,
    OutboxRepository,
    OutboxRegistry,
    OutboxDrain,
    { provide: OUTBOX_FLUSH, useExisting: OutboxDrain },
  ],
  exports: [InternalClient, OutboxRepository, OutboxRegistry, OutboxDrain, OUTBOX_FLUSH],
})
export class OutboxDeliveryModule {}
