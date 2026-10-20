import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { config } from '../config.js';
import type { MailMessage, MailPort } from './ports.js';

/**
 * Доставка листів справжнім SMTP.
 *
 * Транспорт описується ОДНИМ рядком підключення `SMTP_URL`
 * (`smtps://user:pass@smtp.example.com:465`), а не пʼятьма змінними. Причина
 * практична: у платформах розгортання секрет додається поштучно, і один
 * секрет замість пʼяти — це на чотири способи помилитись менше. Формат той
 * самий, що розуміють усі поштові провайдери.
 *
 * Зʼєднання НЕ перевіряється на старті: поштовий шлюз, який лежить у момент
 * запуску, не привід не піднімати застосунок — розклад і оплата від пошти не
 * залежать. Перша ж невдала відправка пишеться в лог із причиною.
 */
@Injectable()
export class SmtpMailAdapter implements MailPort, OnModuleDestroy {
  readonly configured = true;
  private readonly log = new Logger('Mail');
  private readonly transport: Transporter;

  constructor() {
    // Параметри транспорту й поля листа — різні речі: `from` задається на
    // кожному листі, тут лише те, що стосується зʼєднання.
    this.transport = createTransport(config.mail.smtpUrl!, {
      // Пошта не критична до затримки, але висіти вічно теж не має права.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    } as Record<string, unknown>);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({
      from: config.mail.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    // Адреса в лозі — так, тема — так, вміст — ніколи: у ньому одноразовий код.
    this.log.log(`надіслано «${message.subject}» → ${message.to}`);
  }

  onModuleDestroy(): void {
    this.transport.close();
  }
}
