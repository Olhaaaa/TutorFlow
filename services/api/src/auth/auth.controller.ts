import {
  Body, Controller, Get, HttpCode, Patch, Post, UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { LoginDto, UpdateTimeZoneDto } from './dto.js';
import { CurrentUser, type CurrentUserInfo } from './current-user.decorator.js';

@ApiTags('Вхід')
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('auth/login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Вхід за поштою й паролем',
    description: 'Повертає токен. Далі він передається в заголовку Authorization: Bearer.',
  })
  @ApiResponse({ status: 401, description: 'невірна пошта або пароль' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me')
  @ApiOperation({ summary: 'Хто я за поточним токеном' })
  me(@CurrentUser() user: CurrentUserInfo | null) {
    if (!user) throw new UnauthorizedException('потрібен токен');
    return user;
  }

  @Patch('me/timezone')
  @ApiOperation({
    summary: 'Змінити власний часовий пояс',
    description:
      'Працює для обох ролей. Уже створені заняття не рухаються — змінюється '
      + 'лише зона, у якій вони показуються, і зона, в якій розгортається '
      + 'тижневий шаблон викладача.',
  })
  @ApiResponse({ status: 400, description: 'невідома назва зони' })
  updateTimeZone(@Body() dto: UpdateTimeZoneDto, @CurrentUser() user: CurrentUserInfo | null) {
    if (!user) throw new UnauthorizedException('потрібен токен');
    return this.auth.updateTimezone({ id: user.id, role: user.role }, dto.timezone);
  }
}
