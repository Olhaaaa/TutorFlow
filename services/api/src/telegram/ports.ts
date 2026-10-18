import type { StudentContact } from '@tutorflow/contracts';

/**
 * МЕЖА КАНАЛУ. Оголошена каналом нагадувань, реалізується тим, хто тримає
 * контакти студентів.
 *
 * Канал знає про студента рівно три речі: як його звати, чи привʼязаний у
 * нього чат і який код привʼязки показати. Балансу, занять і пошти він не
 * бачить — і не повинен, бо нагадування не його справа вирішувати.
 *
 * Контракт описаний типом із `@tutorflow/contracts`, а не власним: у
 * лабораторній 3 той самий контакт приїжджає в сервіс нагадувань як завдання
 * з outbox, і двох описів того самого запису бути не має.
 */
export interface ContactsPort {
  /** Контакт студента або null, якщо такого студента канал не знає. */
  contact(studentId: number): Promise<StudentContact | null>;

  /**
   * Код привʼязки, який можна показати. Якщо коду ще немає — створюється.
   * Генерує код викликач, а не реалізація: формат коду — властивість каналу.
   */
  ensureLinkCode(studentId: number, code: string): Promise<StudentContact | null>;

  /**
   * Привʼязати чат за кодом. Код ЗГОРЯЄ: повторне надсилання того самого коду
   * іншим чатом нічого не перезапише.
   *
   * @returns кого привʼязали; null якщо такого коду немає.
   */
  link(code: string, chatId: number | string): Promise<{ id: number; name: string } | null>;

  unlink(studentId: number): Promise<void>;
}

export const CONTACTS_PORT = 'CONTACTS_PORT';
