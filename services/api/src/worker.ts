import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config } from './config.js';
import { MaintenanceService } from './maintenance/maintenance.service.js';
import { WorkerModule } from './worker.module.js';

/**
 * Воркер переходів станів — друга точка входу того самого коду.
 *
 * `createApplicationContext`, а не `create`: HTTP-сервера тут немає взагалі,
 * тому воркер не слухає порт, не має маршрутів і його не можна випадково
 * виставити назовні. Nest при цьому лишається — з ним лишаються і впорскування
 * залежностей, і спільні модули з API.
 *
 * Чому це окремий процес, а не таймер в API, як у лабораторній 1: таймер
 * усередині веб-процесу живе, лише доки той не заснув. На безкоштовному тарифі
 * Render сервіс засинає після 15 хвилин простою, і разом із ним спиняються
 * переходи — неоплачене закріплення не звільняється, проведене заняття не
 * закривається. Воркер цю роботу відв'язує від наявності запросів, а в
 * лабораторній 4 саме його кількість масштабує KEDA.
 *
 * Інтервал задає `MAINTENANCE_INTERVAL_SEC`. Нуль означає «один прохід і
 * вийти»: у такому вигляді воркер придатний і для `docker compose run`, і для
 * CronJob, де розкладом керує не процес, а платформа.
 */
const log = new Logger('Worker');

/** Сон, який можна перервати: інакше SIGTERM чекав би повного інтервалу. */
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
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  const maintenance = app.get(MaintenanceService);
  const intervalSec = config.maintenanceIntervalSec;

  /** Один прохід. Помилка не гасить воркер: наступний прохід спробує знову. */
  const tick = async (): Promise<void> => {
    try {
      const r = await maintenance.runOnce();
      // Тиша, коли робити нема чого: інакше лог засмічується щохвилини.
      if (r.holdsExpired || r.lessonsCompleted || r.paymentsExpired) {
        log.log(
          `звільнено закріплень: ${r.holdsExpired}, `
          + `проведено занять: ${r.lessonsCompleted}, `
          + `протерміновано рахунків: ${r.paymentsExpired}`,
        );
      }
    } catch (e) {
      log.error(`прохід не вдався: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (intervalSec <= 0) {
    log.log('один прохід (MAINTENANCE_INTERVAL_SEC=0)');
    await tick();
    await app.close();
    return;
  }

  let stopping = false;
  let wakeUp = (): void => {};

  // Контейнер спиняють SIGTERM. Без обробника Docker чекав би 10 секунд і
  // вбивав процес посеред транзакції.
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.log(`${signal}: завершую після поточного проходу`);
    wakeUp();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  log.log(`переходи станів кожні ${intervalSec} с`);

  while (!stopping) {
    await tick();
    if (stopping) break;
    const sleep = interruptibleSleep(intervalSec * 1000);
    wakeUp = sleep.wake;
    await sleep.done;
  }

  await app.close();
  log.log('воркер спинився');
}

void bootstrap();
