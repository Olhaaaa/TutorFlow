import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentStudent, CurrentTeacher } from '../auth/current-user.decorator.js';
import type { StudentContext } from '../scheduling/scheduling.service.js';
import { ConnectPaymentsDto, CreatePaymentDto } from './dto.js';
import { PaymentsService } from './payments.service.js';

/**
 * Сире тіло запросу потрібне для перевірки підпису: провайдер підписує саме
 * байти, а не розібраний JSON. Його кладе Nest, якщо застосунок створено з
 * `{ rawBody: true }` — див. main.ts.
 */
interface RawBodyRequest {
  rawBody?: Buffer;
}

@ApiTags('Платежі')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Створити рахунок на поповнення',
    description:
      'Повертає посилання на сторінку оплати провайдера. Баланс НЕ змінюється: '
      + 'кошти зараховує вебхук, а не повернення користувача з платіжної сторінки.',
  })
  @ApiResponse({ status: 503, description: 'еквайринг не налаштований' })
  create(@Body() dto: CreatePaymentDto, @CurrentStudent() student: StudentContext) {
    return this.payments.create(student.id, student.teacherId, dto.amountMinor);
  }

  @Get('options')
  @ApiOperation({
    summary: 'Чи доступна оплата карткою цьому студенту',
    description: 'Залежить від того, чи підключив його викладач приймання оплати.',
  })
  async options(@CurrentStudent() student: StudentContext) {
    const c = await this.payments.connection(student.teacherId);
    return { enabled: c.connected || c.fallbackAvailable };
  }

  // Маршрути викладача оголошені ДО :id навмисно: Nest зіставляє їх у порядку
  // оголошення, і 'teacher' інакше потрапив би в :id як «ідентифікатор».
  @Get('teacher/connection')
  @ApiOperation({ summary: 'Стан підключення еквайрингу викладача' })
  connection(@CurrentTeacher() teacher: { id: number }) {
    return this.payments.connection(teacher.id);
  }

  @Post('teacher/connection')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Підключити власний рахунок',
    description:
      'Токен перевіряється у провайдера до збереження й лягає в базу зашифрованим. '
      + 'Назад він не віддається ніколи — лише кілька останніх символів.',
  })
  @ApiResponse({ status: 400, description: 'провайдер не прийняв токен' })
  connect(@Body() dto: ConnectPaymentsDto, @CurrentTeacher() teacher: { id: number }) {
    return this.payments.connect(teacher.id, dto.token.trim());
  }

  @Delete('teacher/connection')
  @ApiOperation({ summary: 'Відключити рахунок' })
  disconnect(@CurrentTeacher() teacher: { id: number }) {
    return this.payments.disconnect(teacher.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Статус платежу',
    description: 'Для сторінки повернення: вона опитує статус, доки той не стане остаточним.',
  })
  @ApiResponse({ status: 403, description: 'це не ваш платіж' })
  status(@Param('id', ParseIntPipe) id: number, @CurrentStudent() student: StudentContext) {
    return this.payments.byId(student.id, id);
  }

  /**
   * Вебхук monobank.
   *
   * Автентифікації тут немає й бути не може — запрос робить провайдер, а не
   * користувач. Замість неї працює підпис `X-Sign`, і саме він вирішує, чи
   * довіряти тілу. Маршрут схований зі Swagger: він не для людей.
   */
  @Post('monobank/callback')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  callback(@Req() req: RawBodyRequest, @Headers('x-sign') signature: string) {
    if (!req.rawBody) {
      throw new BadRequestException('порожнє тіло запросу');
    }
    return this.payments.handleWebhook(req.rawBody, signature ?? '');
  }
}
