import { Injectable } from '@nestjs/common';
import { StudentsRepository } from '../billing/students.repository.js';
import { TeachersRepository } from '../scheduling/teachers.repository.js';
import type { CredentialsPort, CredentialRecord, IdentityRecord, TeacherRegistration } from './ports.js';
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
        emailVerified: teacher.email_verified_at !== null,
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
        // Студента заводить викладач — адресу вже підтвердила людина.
        emailVerified: true,
      };
    }

    return null;
  }

  updateTimezone(id: number, role: Role, timezone: string) {
    return role === 'teacher'
      ? this.teachers.updateTimezone(id, timezone)
      : this.students.updateTimezone(id, timezone);
  }

  async createTeacher(reg: TeacherRegistration): Promise<IdentityRecord | null> {
    const row = await this.teachers.createUnverified(reg);
    if (!row) return null;

    return {
      id: row.id,
      role: 'teacher',
      name: row.name,
      email: row.email,
      emailVerified: false,
    };
  }

  async identityById(id: number, role: Role): Promise<IdentityRecord | null> {
    if (role === 'teacher') {
      const t = await this.teachers.identityById(id);
      return t && {
        id: t.id, role: 'teacher', name: t.name, email: t.email,
        emailVerified: t.email_verified_at !== null,
      };
    }

    const s = await this.students.identityById(id);
    return s && { id: s.id, role: 'student', name: s.name, email: s.email, emailVerified: true };
  }

  async markEmailVerified(id: number, at: Date): Promise<boolean> {
    return (await this.teachers.markEmailVerified(id, at)) !== null;
  }

  setPassword(id: number, role: Role, passwordHash: string, at: Date): Promise<void> {
    return role === 'teacher'
      ? this.teachers.setPassword(id, passwordHash, at)
      : this.students.setPassword(id, passwordHash, at);
  }
}
