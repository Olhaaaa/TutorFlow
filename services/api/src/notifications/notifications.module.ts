import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module.js';
import { NotificationsConsumer } from './notifications.consumer.js';
import { NotificationsDelivery } from './notifications.delivery.js';
import { NotificationsRepository } from './notifications.repository.js';

/**
 * Нагадування. Модуль живе у вертикалі «Гроші й канали» й у лабораторній 3
 * стане окремим сервісом `notifications` — тим самим, що в плані мікросервісів.
 *
 * Споживач подій тут, але запускає його воркер: модуль описує, ЩО вміє робити,
 * а не хто й коли це робить.
 */
@Module({
  imports: [TelegramModule],
  providers: [NotificationsRepository, NotificationsDelivery, NotificationsConsumer],
  exports: [NotificationsRepository, NotificationsDelivery, NotificationsConsumer],
})
export class NotificationsModule {}
