import { Global, Module } from '@nestjs/common';
import { EventBus } from './event-bus.js';

/**
 * Шина подій. Глобальний модуль, бо публікувати події має право кожен домен, а
 * тягнути імпорт у кожен модуль означало б описувати ту саму залежність
 * десять разів. Так само зроблено з доступом до бази.
 */
@Global()
@Module({
  providers: [EventBus],
  exports: [EventBus],
})
export class EventsModule {}
