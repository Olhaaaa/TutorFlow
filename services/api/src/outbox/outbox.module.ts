import { Global, Module } from '@nestjs/common';
import { NEW_STUDENT_SINK } from '../billing/ports.js';
import { NoopNewStudentSink, NoopOutboxFlush, OUTBOX_FLUSH } from './flush.js';

/**
 * Межа доставки в МОНОЛІТІ: її немає.
 *
 * Модуль глобальний і постачає порожню реалізацію `OutboxFlush`, щоб доменні
 * сервіси могли викликати `flush()` після коміту, не знаючи, у якій
 * архітектурі вони працюють. У моноліті виклик нічого не робить, бо спільна
 * транзакція вже все гарантувала.
 *
 * Сервіси лабораторної 3 замість цього модуля імпортують той, що постачає
 * справжній дренаж, — і тільки в цьому відмінність.
 */
@Global()
@Module({
  providers: [
    { provide: OUTBOX_FLUSH, useClass: NoopOutboxFlush },
    { provide: NEW_STUDENT_SINK, useClass: NoopNewStudentSink },
  ],
  exports: [OUTBOX_FLUSH, NEW_STUDENT_SINK],
})
export class NoopOutboxModule {}
