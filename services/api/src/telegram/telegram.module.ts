import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { ContactsAdapter } from './contacts.adapter.js';
import { CONTACTS_PORT } from './ports.js';
import { TelegramClient } from './telegram.client.js';
import { TelegramController } from './telegram.controller.js';
import { TelegramService } from './telegram.service.js';
import { TelegramUpdates } from './telegram.updates.js';

/**
 * Канал нагадувань.
 *
 * Контакти беруться через CONTACTS_PORT. У моноліті його реалізує адаптер над
 * `students` — тією самою таблицею, що тримає баланс, тому модуль і залежить
 * від білінгу. У лабораторній 3 залежність зникає: сервіс нагадувань тримає
 * власну проєкцію контактів, а баланс його не цікавить узагалі.
 */
@Module({
  imports: [BillingModule],
  controllers: [TelegramController],
  providers: [
    TelegramClient, TelegramService, TelegramUpdates,
    ContactsAdapter,
    { provide: CONTACTS_PORT, useExisting: ContactsAdapter },
  ],
  exports: [TelegramService, TelegramUpdates],
})
export class TelegramModule {}
