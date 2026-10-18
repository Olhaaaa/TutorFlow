import { Injectable } from '@nestjs/common';
import type { StudentContact } from '@tutorflow/contracts';
import { StudentsRepository } from '../billing/students.repository.js';
import type { ContactsPort } from './ports.js';

/**
 * Контакти з таблиці `students`.
 *
 * У моноліті ця таблиця належить білінгу, тому адаптер і живе на межі: канал
 * бачить лише порт. У лабораторній 3 той самий клас працює вже у сервісі
 * нагадувань — над ЙОГО базою, де `students` лишилась проєкцією з двох
 * колонок, які каналу й потрібні. Код адаптера при цьому не змінюється: мінявся
 * не доступ до даних, а те, чиї вони.
 */
@Injectable()
export class ContactsAdapter implements ContactsPort {
  constructor(private readonly students: StudentsRepository) {}

  async contact(studentId: number): Promise<StudentContact | null> {
    const row = await this.students.telegramState(studentId);
    return row ? toContact(row) : null;
  }

  async ensureLinkCode(studentId: number, code: string): Promise<StudentContact | null> {
    const row = await this.students.ensureLinkCode(studentId, code);
    return row ? toContact(row) : null;
  }

  async link(code: string, chatId: number | string) {
    const row = await this.students.linkTelegram(code, chatId);
    return row ? { id: row.id, name: row.name } : null;
  }

  async unlink(studentId: number): Promise<void> {
    await this.students.unlinkTelegram(studentId);
  }
}

function toContact(row: {
  id: number; name: string; timezone: string;
  telegram_chat_id: number | null; telegram_link_code: string | null;
}): StudentContact {
  return {
    studentId: row.id,
    name: row.name,
    timezone: row.timezone,
    telegramChatId: row.telegram_chat_id,
    telegramLinkCode: row.telegram_link_code,
  };
}
