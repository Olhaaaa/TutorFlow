import { Controller, Get, Inject } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { sql } from 'kysely';
import { KYSELY, type Database } from '../db/database.module.js';

@Controller()
export class HealthController {
  constructor(@Inject(KYSELY) private readonly db: Database) {}

  /**
   * Перевірка живості для Cloud Run. Навмисно поза префіксом /api,
   * бо платформа стукає в корінь.
   */
  @Get('healthz')
  @ApiExcludeEndpoint()
  async healthz(): Promise<{ status: string; db: string }> {
    try {
      await sql`select 1`.execute(this.db);
      return { status: 'ok', db: 'up' };
    } catch {
      return { status: 'degraded', db: 'down' };
    }
  }
}
