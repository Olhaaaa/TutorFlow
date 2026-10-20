import { Global, Module } from '@nestjs/common';
import { config } from '../config.js';
import { LogMailAdapter } from './log.adapter.js';
import { MAIL_PORT } from './ports.js';
import { SmtpMailAdapter } from './smtp.adapter.js';

/**
 * Пошта доступна всюди, тому модуль глобальний: її потребує вхід, а в
 * майбутньому потребуватимуть нагадування.
 *
 * Вибір реалізації — за наявністю `SMTP_URL`, і робиться він ОДИН раз при
 * збиранні модуля, а не на кожному листі. Так у логах одразу видно, у якому
 * режимі працює застосунок, і неможлива ситуація «половина листів пішла,
 * половина лягла в лог».
 */
@Global()
@Module({
  providers: [
    {
      provide: MAIL_PORT,
      useClass: config.mail.smtpUrl ? SmtpMailAdapter : LogMailAdapter,
    },
  ],
  exports: [MAIL_PORT],
})
export class MailModule {}
