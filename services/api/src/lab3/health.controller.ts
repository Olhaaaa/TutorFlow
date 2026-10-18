import { Controller, Get, Inject } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { sql } from 'kysely';
import { KYSELY, type Database } from '../db/database.module.js';
import { OutboxRepository } from '../outbox/outbox.repository.js';
import { serviceRole } from './bootstrap.js';

/**
 * Живість сервіса в мікросервісній композиції.
 *
 * Два поля, яких немає в моноліті. `service` — хто саме відповів: образ один
 * на пʼять сервісів, і без цього рядка неможливо зрозуміти, чи стукаєш туди,
 * куди думаєш. `outbox` — скільки завдань чекає доставки сусідові; нуль
 * означає, що межа жива, а зростання — що сусід не відповідає. Саме це число в
 * лабораторній 4 стане сигналом для масштабування, як довжина стріму для
 * воркера.
 */
@Controller()
export class Lab3HealthController {
  constructor(
    @Inject(KYSELY) private readonly db: Database,
    private readonly outbox: OutboxRepository,
  ) {}

  @Get('healthz')
  @ApiExcludeEndpoint()
  async healthz(): Promise<{ status: string; service: string; db: string; outbox: number }> {
    try {
      await sql`select 1`.execute(this.db);
      return {
        status: 'ok',
        service: serviceRole(),
        db: 'up',
        outbox: await this.outbox.pendingCount(),
      };
    } catch {
      return { status: 'degraded', service: serviceRole(), db: 'down', outbox: -1 };
    }
  }
}
