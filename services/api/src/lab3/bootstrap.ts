import 'reflect-metadata';
import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { lab3 } from './config.js';
import { parseServiceRole, type ServiceRole } from './roles.js';

let role: ServiceRole | null = null;

/**
 * Хто ми. Роль задається аргументом команди, тому її знає і точка входу, і
 * будь-який провайдер — наприклад перевірка живості, якій треба відповісти,
 * ЯКИЙ саме сервіс відповів.
 */
export function serviceRole(): ServiceRole {
  role ??= parseServiceRole(process.argv[2] ?? process.env['SERVICE_ROLE']);
  return role;
}

/**
 * Спільний старт HTTP-сервіса.
 *
 * Один образ, пʼять команд — рівно той самий прийом, що й у лабораторній 2 з
 * воркером. Якби кожен сервіс мав власний образ зі власною збіркою,
 * порівняння архітектур перестало б бути порівнянням архітектур: різниця
 * знайшлася б у збірках, а не в межах.
 *
 * `/internal` виведено з-під префікса `/api` навмисно: gateway проксіює лише
 * `/api`, тому внутрішні маршрути недосяжні ззовні за САМОЮ ФОРМОЮ адреси, а
 * не за налаштуванням, яке можна забути.
 */
export async function bootHttp(module: unknown, description: string): Promise<INestApplication> {
  const name = serviceRole();
  const log = new Logger(`Service:${name}`);

  const app = await NestFactory.create<NestFastifyApplication>(
    module as never,
    new FastifyAdapter(),
    // rawBody потрібен вебхуку платежів: провайдер підписує байти тіла.
    { rawBody: true },
  );

  // Префікс — усім, крім gateway: у того маршрут один і він уже повний
  // (`/api/*`), а другий префікс зробив би з нього `/api/api/*`.
  if (name !== 'gateway') {
    app.setGlobalPrefix('api', { exclude: ['healthz', '/internal/{*path}'] });
  }
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle(`Tutorflow — ${name}`)
        .setDescription(description)
        .setVersion('3')
        .build(),
    ),
  );

  await app.listen(lab3.port, '0.0.0.0');
  log.log(`слухаю :${lab3.port}`);

  return app;
}
