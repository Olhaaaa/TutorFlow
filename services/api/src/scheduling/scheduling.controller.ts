import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentStudent, CurrentTeacher } from '../auth/current-user.decorator.js';
import {
  AvailabilityRuleDto, CalendarQueryDto, EnrollmentDto, GenerateDto,
} from './dto.js';
import { SchedulingService, type StudentContext } from './scheduling.service.js';

@ApiTags('Розклад')
@Controller()
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Get('slots')
  @ApiOperation({
    summary: 'Календар на період',
    description:
      'Час повертається в UTC — конвертацію в зону глядача робить клієнт. ' +
      'Чужі заняття віддаються як busy, без статусу й без імені студента.',
  })
  calendar(@Query() q: CalendarQueryDto, @CurrentStudent() student: StudentContext) {
    return this.scheduling.calendar(
      student.teacherId, new Date(q.from), new Date(q.to), student.id,
    );
  }

  @Post('slots/:id/book')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Забронювати слот',
    description:
      'Балансу достатньо — слот одразу booked; ні — pre_booked із дедлайном оплати. ' +
      'Брак коштів не є помилкою: місце закріплене, лишилось заплатити.',
  })
  @ApiResponse({ status: 201, description: 'статус слота повертається у відповіді' })
  @ApiResponse({ status: 409, description: 'слот уже зайнятий або щойно забрали' })
  book(@Param('id', ParseIntPipe) id: number, @CurrentStudent() student: StudentContext) {
    return this.scheduling.book(id, student);
  }

  @Post('slots/:id/cancel')
  @ApiOperation({
    summary: 'Скасувати заняття',
    description:
      'pre_booked скасовується безкоштовно завжди. Для booked діє правило ' +
      'cancelHours, і межа включна: рівно за 24 години ще безкоштовно.',
  })
  @ApiResponse({ status: 403, description: 'це не ваше заняття' })
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentStudent() student: StudentContext) {
    return this.scheduling.cancel(id, student);
  }

  @Get('teacher/slots')
  @ApiOperation({
    summary: 'Розклад викладача на період',
    description:
      'На відміну від /slots віддає сирий статус заняття й імʼя студента: '
      + 'це власний розклад викладача, приховувати в ньому нема чого.',
  })
  teacherCalendar(@Query() q: CalendarQueryDto, @CurrentTeacher() teacher: { id: number }) {
    return this.scheduling.teacherCalendar(teacher.id, new Date(q.from), new Date(q.to));
  }

  @Get('teacher/availability')
  @ApiOperation({ summary: 'Тижневий шаблон доступності' })
  listAvailability(@CurrentTeacher() teacher: { id: number }) {
    return this.scheduling.listAvailability(teacher.id);
  }

  @Post('teacher/availability')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Задати годину в тижневому шаблоні',
    description: 'startTime — локальний настінний час викладача, не UTC.',
  })
  setAvailability(
    @Body() dto: AvailabilityRuleDto,
    @CurrentTeacher() teacher: { id: number },
  ) {
    return this.scheduling.setAvailability(teacher.id, dto);
  }

  @Post('teacher/slots:generate')
  @ApiOperation({
    summary: 'Згенерувати слоти з шаблону',
    description:
      'Ідемпотентно: повторний виклик не дублює години. Час рахується через ' +
      'AT TIME ZONE, тому переходи на зимовий і літній час враховані.',
  })
  generate(@Body() dto: GenerateDto, @CurrentTeacher() teacher: { id: number }) {
    return this.scheduling.generate(teacher.id, dto.weeks ?? 4);
  }

  @Get('teacher/enrollments')
  @ApiOperation({
    summary: 'Постійні місця студентів у розкладі',
    description: 'Активні закріплення: хто, якого дня тижня й о котрій годині.',
  })
  listEnrollments(@CurrentTeacher() teacher: { id: number }) {
    return this.scheduling.listEnrollments(teacher.id);
  }

  @Post('teacher/enrollments')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Закріпити студента за годиною',
    description: 'Майбутні вільні слоти на цю годину одразу стають pre_booked.',
  })
  enroll(@Body() dto: EnrollmentDto, @CurrentTeacher() teacher: { id: number }) {
    return this.scheduling.enroll(teacher.id, dto.studentId, {
      weekday: dto.weekday,
      startTime: dto.startTime,
    });
  }

  @Delete('teacher/enrollments/:id')
  @ApiOperation({
    summary: 'Зняти закріплення',
    description: 'Майбутні неоплачені слоти звільняються.',
  })
  unenroll(@Param('id', ParseIntPipe) id: number, @CurrentTeacher() teacher: { id: number }) {
    return this.scheduling.unenroll(teacher.id, id);
  }
}
