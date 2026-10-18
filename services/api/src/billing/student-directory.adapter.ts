import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { StudentDirectoryPort } from '../scheduling/ports.js';
import { StudentsRepository } from './students.repository.js';

/**
 * Реалізація довідника студентів, якого чекає розклад.
 *
 * Весь зміст адаптера в тому, що він знає про `students`, а розклад — ні.
 * Тут і генерується токен стрічки: таблиця належить білінгу, тому вирішувати,
 * що саме в ній лежить, мусить він. Розклад лише просить «дай адресу».
 *
 * 24 байти випадковості, base64url — токен їде в рядку адреси, і єдине, що
 * його захищає, це неможливість перебрати.
 */
@Injectable()
export class StudentDirectoryAdapter implements StudentDirectoryPort {
  constructor(private readonly students: StudentsRepository) {}

  async namesByIds(ids: readonly number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.students.namesByIds(ids);
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async ensureCalendarToken(studentId: number) {
    const row = await this.students.ensureCalendarToken(
      studentId, randomBytes(24).toString('base64url'),
    );
    if (!row?.calendar_token) return null;
    return {
      id: row.id,
      name: row.name,
      timezone: row.timezone,
      calendarToken: row.calendar_token,
    };
  }

  async clearCalendarToken(studentId: number): Promise<void> {
    await this.students.clearCalendarToken(studentId);
  }

  async byCalendarToken(token: string) {
    const row = await this.students.byCalendarToken(token);
    if (!row) return null;
    return { id: row.id, teacherId: row.teacher_id, name: row.name, timezone: row.timezone };
  }
}
