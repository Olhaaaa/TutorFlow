import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { CredentialUpsert } from '@tutorflow/contracts';
import { InternalGuard } from './internal.guard.js';
import { CredentialsProjection } from './projections.js';

/**
 * Єдиний внутрішній маршрут сервіса входу: прийми реквізити.
 *
 * Зворотного напрямку немає свідомо. Сусіди не питають вхід, хто цей
 * користувач: токен підписаний спільним секретом, і кожен перевіряє його сам.
 * Інакше вхід став би єдиною точкою відмови для кожного запросу в системі.
 */
@ApiExcludeController()
@UseGuards(InternalGuard)
@Controller('internal')
export class IdentityInternalController {
  constructor(private readonly credentials: CredentialsProjection) {}

  @Post('credentials')
  async upsert(@Body() rec: CredentialUpsert): Promise<{ accepted: true }> {
    await this.credentials.upsert(rec);
    return { accepted: true };
  }
}
