import {
  Body, Controller, Delete, Get, Header, HttpCode, Param, ParseIntPipe, Post, Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentStudent, CurrentTeacher } from '../auth/current-user.decorator.js';
import {
  AvailabilityRuleDto, CalendarQueryDto, EnrollmentDto, ExternalBusyDto, GenerateDto,
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

  @Post('teacher/slots/:id/cancel')
  @ApiOperation({
    summary: 'Скасувати заняття викладачем',
    description:
      'Година звільняється, а списані за заняття кошти повертаються на баланс '
      + 'студента повністю. Правило cancelHours тут не діє: воно захищає час '
      + 'викладача від студента, а не навпаки, тому cancelled_late не виникає.',
  })
  @ApiResponse({ status: 400, description: 'скасовувати нічого або заняття вже почалось' })
  @ApiResponse({ status: 404, description: 'слот не знайдено або належить іншому викладачу' })
  @ApiResponse({ status: 409, description: 'стан слота щойно змінився' })
  cancelByTeacher(
    @Param('id', ParseIntPipe) id: number,
    @CurrentTeacher() teacher: { id: number },
  ) {
    return this.scheduling.cancelByTeacher(id, teacher.id);
  }

  @Get('slots/available')
  @ApiOperation({
    summary: 'Вільні години з урахуванням зайнятості поза розкладом',
    description:
      'Єдина функція доступності. Слот, що накладається на зовнішню подію '
      + 'викладача, сюди не потрапляє — і саме через це інтеграція з чужим '
      + 'календарем не розтікається по коду.',
  })
  available(@Query() q: CalendarQueryDto, @CurrentStudent() student: StudentContext) {
    return this.scheduling.availableSlots(student.teacherId, new Date(q.from), new Date(q.to));
  }

  @Get('teacher/busy')
  @ApiOperation({
    summary: 'Зайнятість викладача поза розкладом',
    description: 'Інтервали, у які години недоступні для бронювання.',
  })
  listBusy(@Query() q: CalendarQueryDto, @CurrentTeacher() teacher: { id: number }) {
    return this.scheduling.listExternalBusy(teacher.id, new Date(q.from), new Date(q.to));
  }

  @Post('teacher/busy')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Позначити себе зайнятим',
    description:
      'Вільні слоти в цьому інтервалі перестають бронюватись. Уже записані '
      + 'заняття НЕ скасовуються: що з ними робити, вирішує людина.',
  })
  addBusy(@Body() dto: ExternalBusyDto, @CurrentTeacher() teacher: { id: number }) {
    return this.scheduling.addExternalBusy(teacher.id, {
      startAt: new Date(dto.startAt),
      endAt: new Date(dto.endAt),
      title: dto.title ?? null,
    });
  }

  @Delete('teacher/busy/:id')
  @ApiOperation({ summary: 'Прибрати інтервал зайнятості' })
  removeBusy(@Param('id', ParseIntPipe) id: number, @CurrentTeacher() teacher: { id: number }) {
    return this.scheduling.removeExternalBusy(teacher.id, id);
  }

  @Get('teacher/calendar-link')
  @ApiOperation({
    summary: 'Адреса стрічки .ics',
    description:
      'Секрет у самій адресі: календарна програма не вміє ні увійти, ні '
      + 'віддати заголовок авторизації. Створюється при першому зверненні.',
  })
  calendarLink(@CurrentTeacher() teacher: { id: number }) {
    return this.scheduling.calendarLink(teacher.id);
  }

  @Delete('teacher/calendar-link')
  @ApiOperation({
    summary: 'Відкликати стрічку',
    description: 'Стара адреса перестає працювати негайно; нову можна випустити заново.',
  })
  revokeCalendarLink(@CurrentTeacher() teacher: { id: number }) {
    return this.scheduling.revokeCalendarLink(teacher.id);
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
