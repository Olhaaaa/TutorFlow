import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { StudentContact } from '@tutorflow/contracts';
import { InternalGuard } from './internal.guard.js';
import { ContactProjection } from './projections.js';

/**
 * Єдиний внутрішній маршрут сервіса нагадувань: ось новий студент.
 *
 * Більше йому від сусідів нічого не потрібно: усе, що він надсилає, приходить
 * подіями зі стріму, а кому надсилати — лежить у власній проєкції контактів.
 */
@ApiExcludeController()
@UseGuards(InternalGuard)
@Controller('internal')
export class NotificationsInternalController {
  constructor(private readonly contacts: ContactProjection) {}

  @Post('contacts')
  async upsert(@Body() contact: StudentContact): Promise<{ accepted: true }> {
    await this.contacts.upsert(contact);
    return { accepted: true };
  }
}
