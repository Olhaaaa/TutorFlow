import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SchedulingService } from './scheduling.service.js';

/**
 * Стрічка календаря. Єдиний маршрут застосунку БЕЗ автентифікації користувача,
 * і це не недогляд.
 *
 * Календарна програма, яка підписується на стрічку, не вміє ні увійти, ні
 * віддати заголовок авторизації — вона вміє відкрити URL. Тому доступ дає сам
 * токен в адресі. Звідси два наслідки: токен мусить бути довгим і випадковим,
 * і його мусить бути можна відкликати. Обидва виконані.
 *
 * Контролер окремий від SchedulingController саме тому, що в нього інша модель
 * доступу: тримати маршрут без автентифікації поруч із тими, що її вимагають,
 * — найкращий спосіб колись випадково зняти її не з того.
 */
@ApiTags('Розклад')
@Controller()
export class CalendarController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Get('calendar/student/:token')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Cache-Control', 'private, max-age=60')
  @ApiOperation({
    summary: 'Стрічка занять студента',
    description:
      'Окремий токен і окремий шлях: у стрічці лише заняття цього студента. '
      + 'Сегмент student іде ПЕРЕД токеном, тому з викладацьким маршрутом '
      + 'вона не плутається — у того шлях на сегмент коротший.',
  })
  @ApiResponse({ status: 404, description: 'стрічку відкликано або адреса хибна' })
  studentFeed(@Param('token') token: string): Promise<string> {
    return this.scheduling.studentCalendarFeed(token.replace(/\.ics$/i, ''));
  }

  @Get('calendar/:token')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  // Стрічку перечитують цілком і часто — хай проміжні кеші тримають її хвилину.
  @Header('Cache-Control', 'private, max-age=60')
  @ApiOperation({
    summary: 'Стрічка занять у форматі iCalendar',
    description:
      'Адреса містить секретний токен викладача. Розширення .ics у кінці '
      + 'необовʼязкове — деякі програми додають його самі.',
  })
  @ApiResponse({ status: 404, description: 'стрічку відкликано або адреса хибна' })
  feed(@Param('token') token: string): Promise<string> {
    // Деякі календарі дописують розширення до адреси самі.
    return this.scheduling.calendarFeed(token.replace(/\.ics$/i, ''));
  }
}
