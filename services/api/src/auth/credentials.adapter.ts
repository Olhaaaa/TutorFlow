import { Injectable } from '@nestjs/common';
import { StudentsRepository } from '../billing/students.repository.js';
import { TeachersRepository } from '../scheduling/teachers.repository.js';
import type { CredentialsPort, CredentialRecord } from './ports.js';
import type { Role } from './token.service.js';

/**
 * Реквізити входу з таблиць `teachers` і `students`.
 *
 * Порядок пошуку — спершу викладачі, потім студенти — лишився тим самим, що
 * був у сервісі входу. Він не випадковий: викладачів одиниці, студентів
 * багато, і перший запрос у більшості входів марний саме для студента. Міняти
 * порядок без заміру немає за чим, тому він переїхав як є.
 *
 * У МОНОЛІТІ це єдине місце застосунку, яке читає дані обох вертикалей, —
 * тому поділ на сервіси зачіпає вхід першим.
 *
 * У СЕРВІСІ ВХОДУ той самий клас працює без змін, і це не випадковість: там
 * обидві таблиці його власні, і від них лишились лише колонки входу. Різниця
 * не в доступі до даних, а в тому, чиї вони.
 */
@Injectable()
export class LocalCredentialsAdapter implements CredentialsPort {
  constructor(
    private readonly teachers: TeachersRepository,
    private readonly students: StudentsRepository,
  ) {}

  async byEmail(email: string): Promise<CredentialRecord | null> {
    const teacher = await this.teachers.byEmailWithSecret(email);
    if (teacher) {
      return {
        id: teacher.id,
        role: 'teacher',
        email: teacher.email,
        passwordHash: teacher.password_hash,
        name: teacher.name,
        timezone: teacher.timezone,
        teacherId: teacher.id,
      };
    }

    const student = await this.students.byEmailWithSecret(email);
    if (student) {
      return {
        id: student.id,
        role: 'student',
        email: student.email,
        passwordHash: student.password_hash,
        name: student.name,
        timezone: student.timezone,
        teacherId: student.teacher_id,
      };
    }

    return null;
  }

  updateTimezone(id: number, role: Role, timezone: string) {
    return role === 'teacher'
      ? this.teachers.updateTimezone(id, timezone)
      : this.students.updateTimezone(id, timezone);
  }
}
