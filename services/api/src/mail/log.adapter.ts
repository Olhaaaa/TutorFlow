import { Injectable, Logger } from '@nestjs/common';
import type { MailMessage, MailPort } from './ports.js';

/**
 * Лист у лог замість пошти.
 *
 * Вмикається сам, коли `SMTP_URL` не заданий, і це не заглушка «щоб
 * компілювалось»: у лабораторній роботі робочого поштового шлюзу зазвичай
 * немає, а перевірити реєстрацію треба. З цим адаптером посилання
 * підтвердження видно в лозі контейнера — `docker compose logs api` або
 * `kubectl logs` — і весь потік лишається перевірюваним.
 *
 * Текст пишеться ЦІЛКОМ, разом із посиланням. Це свідомий компроміс режиму
 * розробки: у продакшні з налаштованим SMTP логується лише тема й адреса.
 */
@Injectable()
export class LogMailAdapter implements MailPort {
  readonly configured = false;
  private readonly log = new Logger('Mail');

  async send(message: MailMessage): Promise<void> {
    this.log.warn(
      `SMTP не налаштований — лист не надіслано, а записаний нижче.\n`
      + `кому: ${message.to}\nтема: ${message.subject}\n${message.text}`,
    );
  }
}
