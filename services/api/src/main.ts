import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { config } from './config.js';

async function bootstrap(): Promise<void> {
  // FastifyAdapter, не Express: холодний старт нижчий, а при scale-to-zero
  // це властивість, яку бачить користувач.
  // rawBody потрібен вебхуку платежів: провайдер підписує байти тіла, і
  // перевіряти підпис над повторно серіалізованим JSON не можна.
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    rawBody: true,
  });

  app.setGlobalPrefix('api', { exclude: ['healthz'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Tutorflow API')
        .setDescription('Розклад і білінг для репетиторів')
        .setVersion('1')
        .build(),
    ),
  );

  // Cloud Run передає порт у $PORT і чекає 0.0.0.0.
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap();
