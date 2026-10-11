import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';
import { config } from '../config.js';
import { EVENTS_STREAM, type DomainEvent } from './events.js';

/**
 * Публікація подій у Redis Stream.
 *
 * Три рішення, які варто назвати прямо.
 *
 * **Публікація не має права зламати запрос.** Якщо Redis недоступний,
 * `publish` пише в лог і повертається — студент усе одно отримав свою
 * відповідь, а заняття вже заброньоване. Ціна в тому, що подія при цьому
 * ГУБИТЬСЯ: це at-most-once на боці публікації. Справжня гарантія вимагає
 * outbox — запису події в ту саму транзакцію, що й зміна даних, — і він
 * зʼявиться в лабораторній 3 разом із окремими базами, бо саме там без нього
 * не обійтись.
 *
 * **Без REDIS_URL шина просто вимкнена.** Застосунок мусить підніматись і
 * працювати без Redis: так його запускають локально однією командою, і так він
 * розгорнутий у лабораторній 1. Вимкнена шина — не помилка конфігурації, а
 * режим.
 *
 * **З'єднання лінива.** Воркер і API живуть різний час, і тримати відкритий
 * сокет у процесі, який жодної події не опублікує, немає за чим.
 */
@Injectable()
export class EventBus implements OnApplicationShutdown {
  private readonly log = new Logger('EventBus');
  private client: RedisClientType | null = null;
  private connecting: Promise<RedisClientType> | null = null;
  private warned = false;

  get enabled(): boolean {
    return config.redisUrl !== null;
  }

  private async connect(): Promise<RedisClientType> {
    if (this.client?.isReady) return this.client;
    // Паралельні публікації не повинні відкривати по з'єднанню кожна.
    this.connecting ??= (async () => {
      const client: RedisClientType = createClient({ url: config.redisUrl! });
      client.on('error', (e: unknown) => {
        // Без обробника node-redis валить процес необробленим відхиленням.
        this.log.warn(`Redis: ${e instanceof Error ? e.message : String(e)}`);
      });
      await client.connect();
      this.client = client;
      return client;
    })();

    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  /**
   * Опублікувати подію. Викликається ПІСЛЯ коміту транзакції: подія описує
   * факт, якого вже не відкотити.
   *
   * Ніколи не кидає виняток.
   */
  async publish(event: DomainEvent): Promise<void> {
    if (!this.enabled) {
      if (!this.warned) {
        this.warned = true;
        this.log.log('шина вимкнена: не задано REDIS_URL — події не публікуються');
      }
      return;
    }

    try {
      const client = await this.connect();
      await client.xAdd(
        EVENTS_STREAM,
        '*',
        { type: event.type, at: new Date().toISOString(), data: JSON.stringify(event) },
        // Стрім не повинен рости безмежно: історія подій тут не сховище, а
        // буфер між процесами. ~ дозволяє Redis обрізати цілими вузлами й не
        // платити за точність, якої нам не треба.
        { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 10_000 } },
      );
    } catch (e) {
      this.log.warn(
        `подію ${event.type} не опубліковано: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client?.isOpen) await this.client.quit();
    this.client = null;
  }
}
