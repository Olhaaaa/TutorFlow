import {
  Body, Controller, Get, HttpCode, Inject, Param, ParseIntPipe, Post, UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { ApplyPaymentResult, PendingLessons, TeacherProfile } from '@tutorflow/contracts';
import { KYSELY, type Database } from '../db/database.module.js';
import { OUTBOX_FLUSH, type OutboxFlush } from '../outbox/flush.js';
import { LESSONS_PORT, type LessonsPort } from '../billing/ports.js';
import { TeachersRepository } from '../scheduling/teachers.repository.js';
import { TeacherProfileProjection } from './projections.js';
import { InternalGuard } from './internal.guard.js';

/**
 * Те, що сервіс розкладу віддає СУСІДАМ, а не користувачам.
 *
 * Маршрути свідомо не під `/api`: їх не проксіює gateway, і ззовні до них
 * дістатись неможливо. У Swagger вони теж не йдуть — це не публічний
 * контракт, а межа між процесами, і живе вона в `@tutorflow/contracts`.
 *
 * Усередині — ті самі порти, що в моноліті. Контролер лише перекладає HTTP у
 * виклик порту, тому доменного коду тут немає жодного рядка: інакше дві
 * архітектури почали б розходитись не композицією, а поведінкою.
 */
@ApiExcludeController()
@UseGuards(InternalGuard)
@Controller('internal')
export class SchedulingInternalController {
  constructor(
    @Inject(KYSELY) private readonly db: Database,
    @Inject(LESSONS_PORT) private readonly lessons: LessonsPort,
    @Inject(OUTBOX_FLUSH) private readonly outbox: OutboxFlush,
    private readonly teachers: TeachersRepository,
  
    private readonly teacherProfiles: TeacherProfileProjection,
  ) {}

  /** Неоплачені заняття студента — з них білінг рахує борг у кабінеті. */
  @Get('students/:id/pending-lessons')
  async pending(@Param('id', ParseIntPipe) studentId: number): Promise<PendingLessons> {
    return { lessons: await this.lessons.pendingPayment(studentId) };
  }

  /**
   * Закрити неоплачені заняття коштами, які щойно надійшли.
   *
   * Викликає білінг — одразу після того, як зарахував поповнення. Усередині
   * все як у моноліті: одна транзакція, те саме правило з ядра, ті самі
   * переходи слотів. Різниця одна — списання за закриті заняття лягають у
   * журнал і повертаються в білінг окремими викликами, тому `flush()` тут
   * обовʼязковий: без нього студент побачив би оплачені заняття, за які гроші
   * ще не зняті.
   */
  @Post('students/:id/apply-payment')
  async applyPayment(
    @Param('id', ParseIntPipe) studentId: number,
  ): Promise<ApplyPaymentResult> {
    const converted = await this.db.transaction().execute(
      (tx) => this.lessons.applyPayment(tx, studentId),
    );
    await this.outbox.flush();
    return { convertedSlots: converted };
  }

  /**
   * Зона викладача. Господар колонки — розклад, бо з неї генеруються слоти:
   * саме тут «щосереди о 16:00» перетворюється на момент часу.
   *
   * Викликає сервіс входу, коли людина змінює зону в кабінеті. Запрос приходить
   * саме так, а не навпаки, бо вхід єдиний знає, ХТО його зробив.
   */
  @Post('teachers')
  @HttpCode(200)
  async acceptTeacher(@Body() profile: TeacherProfile): Promise<{ accepted: true }> {
    await this.teacherProfiles.upsertForScheduling(profile);
    return { accepted: true };
  }

  @Post('teachers/:id/timezone')
  async setTeacherTimezone(
    @Param('id', ParseIntPipe) teacherId: number,
    @Body() body: { timezone: string },
  ): Promise<{ id: number; name: string; timezone: string } | null> {
    return this.teachers.updateTimezone(teacherId, body.timezone);
  }
}
