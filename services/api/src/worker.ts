import 'reflect-metadata';
import { hostname } from 'node:os';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config } from './config.js';
import { MaintenanceService } from './maintenance/maintenance.service.js';
import { NotificationsConsumer } from './notifications/notifications.consumer.js';
import { NotificationsDelivery } from './notifications/notifications.delivery.js';
import { TelegramUpdates } from './telegram/telegram.updates.js';
import { parseWorkerRoles } from './worker-roles.js';
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
 *
 * `WORKER_ROLES` вибирає, які з трьох робіт виконує цей процес. У лабораторній
 * 2 їх усі робить один контейнер; у лабораторній 4 вони розійдуться, бо
 * масштабуються по-різному — див. worker-roles.ts.
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
  const consumer = app.get(NotificationsConsumer);
  const delivery = app.get(NotificationsDelivery);
  const telegram = app.get(TelegramUpdates);
  const intervalSec = config.maintenanceIntervalSec;

  const roles = parseWorkerRoles(config.workerRoles);
  log.log(`роли: ${roles.join(', ')}`);

  /*
   * Імʼя споживача мусить бути УНІКАЛЬНИМ на процес, інакше два поди ділили б
   * одну комірку в списку непідтверджених повідомлень Redis. У контейнері
   * процес завжди має pid 1, тому самого pid не досить — а ось hostname у
   * Kubernetes дорівнює імені пода, і він унікальний за побудовою.
   */
  const consumerName = `${hostname()}-${process.pid}`;

  /** Один прохід. Помилка не гасить воркер: наступний прохід спробує знову. */
  const tick = async (): Promise<void> => {
    try {
      const r = await maintenance.runOnce();
      // Нагадування, які не вдалось доставити раніше: канал міг бути
      // недоступним кілька хвилин, і це та сама робота «час настав».
      const resent = await delivery.retryPending();
      // Тиша, коли робити нема чого: інакше лог засмічується щохвилини.
      if (r.holdsExpired || r.lessonsCompleted || r.paymentsExpired || resent) {
        log.log(
          `звільнено закріплень: ${r.holdsExpired}, `
          + `проведено занять: ${r.lessonsCompleted}, `
          + `протерміновано рахунків: ${r.paymentsExpired}, `
          + `дослано нагадувань: ${resent}`,
        );
      }
    } catch (e) {
      log.error(`прохід не вдався: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Один прохід і вихід — вигляд для CronJob. Решта ролей у такому режимі не
  // має сенсу: блокуюче читання стріму не має кінця.
  if (intervalSec <= 0) {
    log.log('один прохід (MAINTENANCE_INTERVAL_SEC=0)');
    if (roles.includes('transitions')) await tick();
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

  if (roles.includes('transitions')) log.log(`переходи станів кожні ${intervalSec} с`);

  /*
   * Дві роботи в одному процесі, і вони різні за природою. Переходи станів
   * тягне ЧАС, тому вони живуть у циклі з інтервалом. Нагадування тягне
   * ПОДІЯ, тому споживач висить на блокуючому читанні стріму й нічого не
   * опитує. Розділяти їх на два контейнери сенсу поки немає: обидві мовчать,
   * доки нема роботи. У лабораторній 4 розділить KEDA — за довжиною стріму.
   */
  const consuming = roles.includes('events')
    ? consumer.run(() => stopping, consumerName)
    : Promise.resolve();
  // Третя робота: оновлення від бота. Теж висить на блокуючому запросі, тому
  // окремого процесу не просить — доки процес один.
  const listening = roles.includes('bot')
    ? telegram.run(() => stopping)
    : Promise.resolve();

  while (!stopping) {
    if (roles.includes('transitions')) await tick();
    if (stopping) break;
    const sleep = interruptibleSleep(intervalSec * 1000);
    wakeUp = sleep.wake;
    await sleep.done;
  }

  // Споживач доопрацьовує поточне повідомлення й виходить сам — на нього
  // чекаємо, інакше процес закрив би з'єднання з базою посеред запису.
  await Promise.all([consuming, listening]);
  await app.close();
  log.log('воркер спинився');
}

void bootstrap();
