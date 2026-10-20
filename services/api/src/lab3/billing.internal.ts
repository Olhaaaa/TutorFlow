import {
  Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param,
  ParseIntPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  INSUFFICIENT_FUNDS,
  type BalanceResult, type MoneyTransfer, type StudentCalendarToken,
  type StudentIdentity, type StudentNames, type TeacherProfile, type TransferResult,
} from '@tutorflow/contracts';
import { StudentsRepository } from '../billing/students.repository.js';
import { STUDENT_DIRECTORY, type StudentDirectoryPort } from '../scheduling/ports.js';
import { InsufficientFundsError, TransfersService } from '../billing/transfers.service.js';
import { PaymentsRepository } from '../payments/payments.repository.js';
import { TeacherProfileProjection } from './projections.js';
import { InternalGuard } from './internal.guard.js';

/**
 * Те, що сервіс білінгу віддає сусідам.
 *
 * Половина маршрутів — читання, яке в моноліті було `join`-ом до `students`:
 * імена для розкладу викладача, власник стрічки `.ics`, баланс. Друга
 * половина — рух коштів, який у моноліті був викликом усередині спільної
 * транзакції.
 *
 * Жодної доменної логіки тут немає: усе, що робить контролер, — перекладає
 * HTTP у виклик того самого сервіса, що й у моноліті. Через це поведінка двох
 * архітектур лишається порівнянною: різниця в межах, не в правилах.
 */
@ApiExcludeController()
@UseGuards(InternalGuard)
@Controller('internal')
export class BillingInternalController {
  constructor(
    private readonly students: StudentsRepository,
    // Той самий порт, що в моноліті викликався напряму: тут він просто
    // виставлений назовні по HTTP.
    @Inject(STUDENT_DIRECTORY) private readonly directory: StudentDirectoryPort,
    private readonly transfers: TransfersService,
    private readonly payments: PaymentsRepository,
  
    private readonly teacherProfiles: TeacherProfileProjection,
  ) {}

  /* ---------- довідник студентів ---------- */

  @Post('teachers')
  @HttpCode(200)
  async acceptTeacher(@Body() profile: TeacherProfile): Promise<{ accepted: true }> {
    await this.teacherProfiles.upsertForBilling(profile);
    return { accepted: true };
  }

  @Get('students/names')
  async names(@Query('ids') ids?: string): Promise<StudentNames> {
    const parsed = (ids ?? '')
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isInteger(v) && v > 0);

    if (parsed.length === 0) return { students: [] };
    const rows = await this.students.namesByIds(parsed);
    return { students: rows.map((r) => ({ id: r.id, name: r.name })) };
  }

  @Get('students/:id/balance')
  async balance(@Param('id', ParseIntPipe) studentId: number): Promise<BalanceResult> {
    const student = await this.students.byId(studentId);
    if (!student) throw new NotFoundException('студента не знайдено');
    return { balanceMinor: student.balance_minor };
  }

  @Post('students/:id/calendar-token')
  async calendarToken(
    @Param('id', ParseIntPipe) studentId: number,
  ): Promise<StudentCalendarToken> {
    const row = await this.directory.ensureCalendarToken(studentId);
    if (!row) throw new NotFoundException('студента не знайдено');
    return row;
  }

  @Post('students/:id/calendar-token/revoke')
  async revokeCalendarToken(
    @Param('id', ParseIntPipe) studentId: number,
  ): Promise<{ revoked: boolean }> {
    await this.directory.clearCalendarToken(studentId);
    return { revoked: true };
  }

  @Get('students/by-calendar-token/:token')
  async byCalendarToken(@Param('token') token: string): Promise<StudentIdentity | null> {
    return this.directory.byCalendarToken(token);
  }

  /**
   * Зона студента. Господар колонки — білінг, бо тут лежить сам студент;
   * запрос приходить від сервіса входу, який єдиний знає, хто його зробив.
   */
  @Post('students/:id/timezone')
  async setTimezone(
    @Param('id', ParseIntPipe) studentId: number,
    @Body() body: { timezone: string },
  ): Promise<{ id: number; name: string; timezone: string } | null> {
    return this.students.updateTimezone(studentId, body.timezone);
  }

  /* ---------- рух коштів ---------- */

  /**
   * Списати за заняття.
   *
   * Відмова через брак коштів віддається кодом `insufficient_funds` у тілі
   * 409, а не текстом: сторона розкладу реагує на неї компенсацією, і
   * вирішувати це за повідомленням означало б вгадувати.
   */
  @Post('transfers/charge')
  charge(@Body() transfer: MoneyTransfer): Promise<TransferResult> {
    return this.apply('lesson_charge', transfer);
  }

  @Post('transfers/refund')
  refund(@Body() transfer: MoneyTransfer): Promise<TransferResult> {
    return this.apply('refund', transfer);
  }

  private async apply(
    kind: 'lesson_charge' | 'refund',
    transfer: MoneyTransfer,
  ): Promise<TransferResult> {
    try {
      return await this.transfers.apply(kind, transfer);
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        throw new ConflictException({
          code: INSUFFICIENT_FUNDS,
          message: 'коштів на балансі не вистачає',
        });
      }
      throw e;
    }
  }

  /* ---------- рахунки ---------- */

  /**
   * Протермінувати несплачені рахунки. Робота проходу переходів станів, але
   * дані — наші, тому виконує її білінг на прохання розкладу.
   */
  @Post('payments/expire')
  async expire(
    @Body() body: { validityMinutes: number },
  ): Promise<{ expired: number }> {
    return { expired: await this.payments.expirePending(body.validityMinutes) };
  }
}
