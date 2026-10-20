import { join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AuthCoreModule } from '../auth/auth.module.js';
import { LocalCredentialsAdapter } from '../auth/credentials.adapter.js';
import { CREDENTIALS_PORT } from '../auth/ports.js';
import { TokenModule } from '../auth/token.module.js';
import { BillingCoreModule } from '../billing/billing.module.js';
import { StudentsRepository } from '../billing/students.repository.js';
import { LESSONS_PORT, NEW_STUDENT_SINK } from '../billing/ports.js';
import { DatabaseModule } from '../db/database.module.js';
import { EventsModule } from '../events/events.module.js';
import { MaintenanceCoreModule } from '../maintenance/maintenance.module.js';
import { PAYMENTS_EXPIRY } from '../maintenance/ports.js';
import { NotificationsCoreModule } from '../notifications/notifications.module.js';
import { PaymentsCoreModule } from '../payments/payments.module.js';
import { CHARGE_PORT, STUDENT_DIRECTORY } from '../scheduling/ports.js';
import { SchedulingCoreModule } from '../scheduling/scheduling.module.js';
import { TeachersRepository } from '../scheduling/teachers.repository.js';
import { LessonsOverHttp, NewStudentFanout } from './billing.adapters.js';
import { BillingInternalController } from './billing.internal.js';
import { BillingOutbox } from './billing.outbox.js';
import { GatewayController } from './gateway.proxy.js';
import { Lab3HealthController } from './health.controller.js';
import { IdentityCredentialsAdapter } from './identity.adapters.js';
import { IdentityInternalController } from './identity.internal.js';
import { IdentityOutbox } from './identity.outbox.js';
import { NotificationsInternalController } from './notifications.internal.js';
import { OutboxDeliveryModule } from './outbox.module.js';
import { ContactProjection, CredentialsProjection, TeacherProfileProjection } from './projections.js';
import {
  ChargeViaOutbox, PaymentsExpiryOverHttp, StudentDirectoryOverHttp,
} from './scheduling.adapters.js';
import { SchedulingInternalController } from './scheduling.internal.js';
import { SchedulingOutbox } from './scheduling.outbox.js';

/*
 * КОМПОЗИЦІЇ ПʼЯТИ СЕРВІСІВ — усі в одному файлі навмисно.
 *
 * Доменний код у лабораторній 3 той самий, що в моноліті: ті самі сервіси, ті
 * самі репозиторії, ті самі контролери, ті самі правила з ядра. Відрізняються
 * архітектури РІВНО тим, що написано нижче: які модулі зібрані в один процес і
 * звідки беруться реалізації портів.
 *
 * Тому ці пʼять оголошень і лежать разом: поставлені поруч, вони читаються як
 * опис межі, а розкидані по каталогах — як п'ять схожих застосунків.
 *
 * Модулі портів глобальні. Це не недбалість: у мікросервісі сусід один на весь
 * процес, і описувати його в кожному доменному модулі окремо нічого не додає —
 * натомість доменні модулі лишаються незміненими, тобто такими самими, як у
 * моноліті.
 */

/* ──────────────────────────── scheduling ──────────────────────────── */

/**
 * Межі розкладу в мікросервісах: гроші й довідник студентів — за мережею.
 *
 * Той самий ChargePort, що в моноліті реалізувався прямим списанням у спільній
 * транзакції, тут пише завдання в outbox. Підпис не змінився; змінилась
 * гарантія.
 */
@Global()
@Module({
  providers: [
    ChargeViaOutbox,
    { provide: CHARGE_PORT, useExisting: ChargeViaOutbox },
    StudentDirectoryOverHttp,
    { provide: STUDENT_DIRECTORY, useExisting: StudentDirectoryOverHttp },
    PaymentsExpiryOverHttp,
    { provide: PAYMENTS_EXPIRY, useExisting: PaymentsExpiryOverHttp },
  ],
  exports: [CHARGE_PORT, STUDENT_DIRECTORY, PAYMENTS_EXPIRY],
})
class SchedulingPortsModule {}

@Module({
  imports: [
    DatabaseModule,
    EventsModule,
    TokenModule,
    OutboxDeliveryModule,
    SchedulingPortsModule,
    SchedulingCoreModule,
    MaintenanceCoreModule,
  ],
  controllers: [SchedulingInternalController, Lab3HealthController],
  providers: [
    TeacherProfileProjection, SchedulingOutbox],
})
export class SchedulingServiceModule {}

/* ───────────────────────────── billing ───────────────────────────── */

/**
 * Межі білінгу: заняття — за мережею, а факт «зʼявився студент» розсилається
 * двом сусідам із тієї самої транзакції, що його створює.
 */
@Global()
@Module({
  providers: [
    LessonsOverHttp,
    { provide: LESSONS_PORT, useExisting: LessonsOverHttp },
    NewStudentFanout,
    { provide: NEW_STUDENT_SINK, useExisting: NewStudentFanout },
  ],
  exports: [LESSONS_PORT, NEW_STUDENT_SINK],
})
class BillingPortsModule {}

@Module({
  imports: [
    DatabaseModule,
    EventsModule,
    TokenModule,
    OutboxDeliveryModule,
    BillingPortsModule,
    BillingCoreModule,
    PaymentsCoreModule,
  ],
  controllers: [BillingInternalController, Lab3HealthController],
  providers: [
    TeacherProfileProjection, BillingOutbox],
})
export class BillingServiceModule {}

/* ───────────────────────────── identity ──────────────────────────── */

/**
 * Межі входу: зміну зони виконує господар колонки, а не вхід.
 *
 * CREDENTIALS_PORT реалізується тут обгорткою над тим самим локальним
 * адаптером, що працює в моноліті: пошук реквізитів не змінився, змінилось
 * лише те, що робиться при зміні зони.
 */
@Global()
@Module({
  providers: [
    // Обидві таблиці реквізитів — власні, тому репозиторії постачаються
    // локально: у цій базі від `teachers` і `students` лишились лише колонки
    // входу, і більше про них ніхто тут не знає.
    TeachersRepository,
    StudentsRepository,
    LocalCredentialsAdapter,
    CredentialsProjection,
    IdentityCredentialsAdapter,
    { provide: CREDENTIALS_PORT, useExisting: IdentityCredentialsAdapter },
  ],
  exports: [CREDENTIALS_PORT, CredentialsProjection],
})
class IdentityPortsModule {}

@Module({
  imports: [
    DatabaseModule,
    TokenModule,
    OutboxDeliveryModule,
    IdentityPortsModule,
    AuthCoreModule,
  ],
  controllers: [IdentityInternalController, Lab3HealthController],
  providers: [IdentityOutbox],
})
export class IdentityServiceModule {}

/* ──────────────────────────── notifications ─────────────────────────── */

@Module({
  imports: [
    DatabaseModule,
    EventsModule,
    TokenModule,
    OutboxDeliveryModule,
    NotificationsCoreModule,
  ],
  controllers: [NotificationsInternalController, Lab3HealthController],
  providers: [ContactProjection],
})
export class NotificationsServiceModule {}

/* ───────────────────────────── gateway ──────────────────────────── */

/**
 * Єдиний сервіс без бази — і без домену.
 *
 * Він віддає ту саму збірку SPA, що моноліт, і проксіює `/api` за таблицею
 * префіксів. `exclude` обовʼязковий із тієї ж причини, що й у моноліті: без
 * нього статика перехопила б усі запроси й API перестало б відповідати.
 */
@Module({
  controllers: [GatewayController],
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(import.meta.dirname, '..', '..', 'static'),
      exclude: ['/api/{*path}'],
    }),
  ],
})
export class GatewayServiceModule {}
