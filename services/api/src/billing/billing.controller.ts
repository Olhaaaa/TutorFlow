import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { hash } from '@node-rs/bcrypt';
import { CurrentStudent, CurrentTeacher } from '../auth/current-user.decorator.js';
import type { StudentContext } from '../scheduling/scheduling.service.js';
import { BillingService } from './billing.service.js';
import { CreateStudentDto, HistoryQueryDto, TopupDto } from './dto.js';

@ApiTags('Гроші')
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('balance')
  @ApiOperation({
    summary: 'Баланс студента',
    description: 'Разом з історією операцій і сумою, якої бракує на закріплені заняття.',
  })
  balance(@CurrentStudent() student: StudentContext) {
    return this.billing.balance(student.id);
  }

  @Get('balance/history')
  @ApiOperation({
    summary: 'Історія операцій студента',
    description:
      'Те саме, що `history` у балансі, але з фільтром напрямку: `in` — '
      + 'надходження (поповнення, повернення), `out` — списання. Фільтр іде в '
      + 'запрос, тому поповнення знаходиться й тоді, коли останні двадцять '
      + 'операцій — самі лише заняття.',
  })
  history(
    @CurrentStudent() student: StudentContext,
    @Query() query: HistoryQueryDto,
  ) {
    return this.billing.history(student.id, query.direction ?? 'all');
  }

  @Get('teacher/students')
  @ApiOperation({ summary: 'Студенти викладача з балансами' })
  students(@CurrentTeacher() teacher: { id: number }) {
    return this.billing.listStudents(teacher.id);
  }

  @Post('teacher/students')
  @HttpCode(201)
  @ApiOperation({ summary: 'Додати студента' })
  async createStudent(
    @Body() dto: CreateStudentDto,
    @CurrentTeacher() teacher: { id: number },
  ) {
    return this.billing.createStudent(teacher.id, {
      name: dto.name,
      email: dto.email,
      timezone: dto.timezone,
      passwordHash: await hash(dto.password, 10),
    });
  }

  @Post('teacher/students/:id/topup')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Поповнити баланс',
    description:
      'Одразу після зарахування закриваються найближчі неоплачені заняття — ' +
      'у відповіді перелік слотів, які стали оплаченими.',
  })
  @ApiResponse({ status: 201, description: 'новий баланс і список закритих слотів' })
  topup(
    @Param('id', ParseIntPipe) studentId: number,
    @Body() dto: TopupDto,
    @CurrentTeacher() teacher: { id: number },
  ) {
    return this.billing.topup(teacher.id, studentId, dto.amountMinor, dto.comment);
  }

  @Get('teacher/students/:id/audit')
  @ApiOperation({
    summary: 'Звірка балансу з журналом',
    description: 'Кешований баланс проти суми транзакцій. Розбіжність означає помилку в коді.',
  })
  @ApiResponse({ status: 404, description: 'студента в цього викладача немає' })
  audit(
    @Param('id', ParseIntPipe) studentId: number,
    @CurrentTeacher() teacher: { id: number },
  ) {
    return this.billing.audit(teacher.id, studentId);
  }
}
