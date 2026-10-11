import { Controller, Delete, Get, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type CurrentUserInfo } from '../auth/current-user.decorator.js';
import { TelegramService } from './telegram.service.js';

/**
 * Привʼязка чату — дія студента над власним профілем, тому маршрути стоять
 * під `/me`, поряд зі зміною часового поясу, а не в кабінеті викладача.
 */
@ApiTags('Нагадування')
@Controller()
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Get('me/telegram')
  @ApiOperation({
    summary: 'Стан каналу нагадувань',
    description:
      'Віддає код привʼязки й готове посилання на бота. Код створюється при '
      + 'першому зверненні й згоряє після привʼязки чату.',
  })
  state(@CurrentUser() user: CurrentUserInfo | null) {
    return this.telegram.state(this.studentOf(user));
  }

  @Delete('me/telegram')
  @ApiOperation({
    summary: 'Відвʼязати чат',
    description: 'Нагадування перестають ходити; журнал нагадувань лишається.',
  })
  unlink(@CurrentUser() user: CurrentUserInfo | null) {
    return this.telegram.unlink(this.studentOf(user));
  }

  /** Канал існує лише для студента: події адресовані йому. */
  private studentOf(user: CurrentUserInfo | null): number {
    if (!user || user.role !== 'student') {
      throw new UnauthorizedException('потрібна автентифікація студента');
    }
    return user.id;
  }
}
