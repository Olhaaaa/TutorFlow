import { Module } from '@nestjs/common';
import { DatabaseModule } from './db/database.module.js';
import { EventsModule } from './events/events.module.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';

/**
 * Корінь воркера.
 *
 * Це НЕ `AppModule` без контролерів, і різниця принципова. Воркер імпортує ті
 * самі доменні модулі, що й API, — через `MaintenanceModule` він тягне і
 * розклад, і платежі, — але не імпортує нічого, що стосується HTTP:
 * `ServeStaticModule` без адаптера впав би, а Swagger і валідаційний пайп тут
 * просто не мають сенсу.
 *
 * Завдяки цьому той самий код переходів станів виконується в двох процесах, і
 * в лабораторній 3, коли модулі роз'їдуться по сервісах, воркер роз'їдеться
 * разом із ними, а не доведеться писати його заново.
 */
@Module({
  imports: [DatabaseModule, EventsModule, MaintenanceModule, NotificationsModule],
})
export class WorkerModule {}
