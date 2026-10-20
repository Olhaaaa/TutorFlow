import 'reflect-metadata';
import { hostname } from 'node:os';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config } from '../config.js';
import { MaintenanceService } from '../maintenance/maintenance.service.js';
import { NotificationsConsumer } from '../notifications/notifications.consumer.js';
import { NotificationsDelivery } from '../notifications/notifications.delivery.js';
import { OutboxDrain } from '../outbox/outbox.drain.js';
import { OutboxRegistry } from '../outbox/outbox.registry.js';
import { TelegramUpdates } from '../telegram/telegram.updates.js';
import { BillingOutbox } from './billing.outbox.js';
import { lab3 } from './config.js';
import { serviceRole } from './bootstrap.js';
import { IdentityOutbox } from './identity.outbox.js';
import { SchedulingOutbox } from './scheduling.outbox.js';
import {
  BillingServiceModule, NotificationsServiceModule, SchedulingServiceModule,
} from './services.js';

/**
 * Фонова робота в мікросервісній композиції.
 *
 *   node dist/lab3/worker.js scheduling
 *
 * Роботи ті самі, що у воркері лабораторної 2, тільки розкладені по сервісах —
 * кожна там, де її дані:
 *
 *   scheduling     переходи станів за часом, нагадування, дренаж журналу
 *   billing        дренаж журналу
 *   notifications  споживач подій, бот, перевідправка недоставленого
 *
 * Сервісу входу воркер не потрібен узагалі: фонової роботи в нього немає.
 *
 * Дренаж журналу тут не головна дорога, а підстраховка: доставку робить той
 * процес, який зробив коміт, одразу й синхронно. Воркер підбирає те, що з
 * першої спроби не доїхало, — і саме він перетворює «ми спробували» на
 * «доставимо точно».
 */
const log = new Logger('Lab3Worker');

function interruptibleSleep(ms: number): { done: Promise<void>; wake: () => void } {
  let wake = (): void => {};
  const done = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  return { done, wake };
}

async function bootstrap(): Promise<void> {
  const role = serviceRole();
  if (role === 'gateway' || role === 'identity') {
    log.log(`сервісу ${role} воркер не потрібен`);
    return;
  }

  const module = role === 'scheduling'
    ? SchedulingServiceModule
    : role === 'billing' ? BillingServiceModule : NotificationsServiceModule;

  const app = await NestFactory.createApplicationContext(module);
  app.enableShutdownHooks();

  const drain = app.get(OutboxDrain);
  if (role === 'scheduling') {
    app.get(OutboxRegistry).register(app.get(SchedulingOutbox).handlers());
  } else if (role === 'billing') {
    app.get(OutboxRegistry).register(app.get(BillingOutbox).handlers());
  }

  let stopping = false;
  let wakeUp = (): void => {};
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    log.log(`${signal}: завершую після поточного проходу`);
    wakeUp();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  const jobs: Promise<unknown>[] = [];

  // Дренаж журналу — у кожного, хто щось відкладає. У нагадувань власного
  // журналу немає: вони нікого не просять, лише слухають стрім.
  if (role !== 'notifications') {
    jobs.push(drain.run(() => stopping, lab3.outboxIntervalMs));
  }

  if (role === 'notifications') {
    const consumer = app.get(NotificationsConsumer);
    const telegram = app.get(TelegramUpdates);
    const delivery = app.get(NotificationsDelivery);

    // Імʼя споживача мусить бути унікальним на процес: інакше два поди ділили
    // б одну комірку в списку непідтверджених повідомлень Redis.
    jobs.push(consumer.run(() => stopping, `${hostname()}-${process.pid}`));
    jobs.push(telegram.run(() => stopping));

    // Перевідправка недоставленого — робота, яку тягне час, тому цикл.
    jobs.push((async () => {
      while (!stopping) {
        try {
          const resent = await delivery.retryPending();
          if (resent) log.log(`дослано нагадувань: ${resent}`);
        } catch (e) {
          log.error(`перевідправка не вдалась: ${msg(e)}`);
        }
        if (stopping) break;
        const sleep = interruptibleSleep(Math.max(config.maintenanceIntervalSec, 10) * 1000);
        wakeUp = sleep.wake;
        await sleep.done;
      }
    })());
  }

  if (role === 'scheduling') {
    const maintenance = app.get(MaintenanceService);
    const intervalSec = config.maintenanceIntervalSec;

    const tick = async (): Promise<void> => {
      try {
        const r = await maintenance.runOnce();
        if (r.holdsExpired || r.lessonsCompleted || r.paymentsExpired) {
          log.log(
            `звільнено закріплень: ${r.holdsExpired}, `
            + `проведено занять: ${r.lessonsCompleted}, `
            + `протерміновано рахунків: ${r.paymentsExpired}`,
          );
        }
      } catch (e) {
        log.error(`прохід не вдався: ${msg(e)}`);
      }
    };

    // Нуль означає «один прохід і вийти» — вигляд для CronJob, як у лабі 2.
    if (intervalSec <= 0) {
      await tick();
      await app.close();
      return;
    }

    log.log(`переходи станів кожні ${intervalSec} с`);
    jobs.push((async () => {
      while (!stopping) {
        await tick();
        if (stopping) break;
        const sleep = interruptibleSleep(intervalSec * 1000);
        wakeUp = sleep.wake;
        await sleep.done;
      }
    })());
  }

  await Promise.all(jobs);
  await app.close();
  log.log(`воркер ${role} спинився`);
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

void bootstrap();
