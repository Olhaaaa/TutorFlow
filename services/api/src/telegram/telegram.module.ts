import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { TelegramClient } from './telegram.client.js';
import { TelegramController } from './telegram.controller.js';
import { TelegramService } from './telegram.service.js';
import { TelegramUpdates } from './telegram.updates.js';

/**
 * Канал нагадувань. Залежить від BillingModule, бо привʼязка чату живе в
 * `students` — а ця таблиця належить вертикалі «Гроші й канали», як і сам
 * канал.
 */
@Module({
  imports: [BillingModule],
  controllers: [TelegramController],
  providers: [TelegramClient, TelegramService, TelegramUpdates],
  exports: [TelegramService, TelegramUpdates],
})
export class TelegramModule {}
