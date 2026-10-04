import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KYSELY, type Database } from '../db/database.module.js';
import type { Executor } from './slots.repository.js';

@Injectable()
export class AvailabilityRepository {
  constructor(@Inject(KYSELY) private readonly root: Database) {}

  private db(tx?: Executor): Executor { return tx ?? this.root; }

  async upsertRule(
    teacherId: number,
    rule: { weekday: number; startTime: string; durationMin: number; priceMinor: number },
    tx?: Executor,
  ) {
    return this.db(tx)
      .insertInto('availability_rules')
      .values({
        teacher_id: teacherId,
        weekday: rule.weekday,
        start_time: rule.startTime,
        duration_min: rule.durationMin,
        price_minor: rule.priceMinor,
      })
      .onConflict((oc) =>
        oc.columns(['teacher_id', 'weekday', 'start_time']).doUpdateSet({
          duration_min: rule.durationMin,
          price_minor: rule.priceMinor,
          is_active: true,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listRules(teacherId: number, tx?: Executor) {
    return this.db(tx)
      .selectFrom('availability_rules')
      .selectAll()
      .where('teacher_id', '=', teacherId)
      .where('is_active', '=', true)
      .orderBy(['weekday', 'start_time'])
      .execute();
  }

  async createEnrollment(
    studentId: number,
    e: { weekday: number; startTime: string },
    tx?: Executor,
  ) {
    return this.db(tx)
      .insertInto('enrollments')
      .values({ student_id: studentId, weekday: e.weekday, start_time: e.startTime })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async deactivateEnrollment(enrollmentId: number, teacherId: number, tx?: Executor) {
    const row = await sql<{ id: number }>`
      update enrollments e
         set is_active = false
       where e.id = ${enrollmentId}
         and e.is_active
         and exists (select 1 from students s
                      where s.id = e.student_id and s.teacher_id = ${teacherId})
      returning e.id
    `.execute(this.db(tx));
    return row.rows[0] ?? null;
  }
}
