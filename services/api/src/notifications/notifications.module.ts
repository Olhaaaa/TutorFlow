import { Module } from '@nestjs/common';
import { NotificationsConsumer } from './notifications.consumer.js';
import { NotificationsRepository } from './notifications.repository.js';

/**
 * Нагадування. Модуль живе у вертикалі «Гроші й канали» й у лабораторній 3
 * стане окремим сервісом `notifications` — тим самим, що в плані мікросервісів.
 *
 * Споживач подій тут, але запускає його воркер: модуль описує, ЩО вміє робити,
 * а не хто й коли це робить.
 */
@Module({
  providers: [NotificationsRepository, NotificationsConsumer],
  exports: [NotificationsRepository, NotificationsConsumer],
})
export class NotificationsModule {}
