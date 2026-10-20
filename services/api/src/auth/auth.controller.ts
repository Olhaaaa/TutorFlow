import {
  Body, Controller, Get, HttpCode, Patch, Post, UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import {
  ChangePasswordDto, EmailOnlyDto, LoginDto, RegisterDto, ResetPasswordDto, TokenDto,
  UpdateTimeZoneDto,
} from './dto.js';
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
  @ApiResponse({ status: 403, description: 'пошта ще не підтверджена' })
  @ApiResponse({ status: 429, description: 'забагато спроб' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('auth/register')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Реєстрація викладача',
    description:
      'Створює акаунт із НЕпідтвердженою поштою й надсилає лист із посиланням. '
      + 'Відповідь однакова і для вільної адреси, і для зайнятої: інакше формою '
      + 'реєстрації можна було б перевіряти, хто в системі є. Студентів ця форма '
      + 'не стосується — їх заводить викладач.',
  })
  @ApiResponse({ status: 202, description: 'лист надіслано, якщо адреса вільна' })
  @ApiResponse({ status: 400, description: 'пароль або зона не годяться' })
  @ApiResponse({ status: 429, description: 'забагато спроб' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('auth/verify-email')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Підтвердити пошту кодом із листа',
    description: 'Код одноразовий і живе добу. Повторне відкриття листа дає 400.',
  })
  @ApiResponse({ status: 400, description: 'посилання недійсне або вже використане' })
  verifyEmail(@Body() dto: TokenDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Post('auth/verify-email/resend')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Надіслати лист підтвердження ще раз',
    description: 'Відповідь однакова для будь-якої адреси. Попередній код гасне.',
  })
  @ApiResponse({ status: 429, description: 'забагато спроб' })
  resendVerification(@Body() dto: EmailOnlyDto) {
    return this.auth.resendVerification(dto.email);
  }

  @Post('auth/password/forgot')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Запросити відновлення пароля',
    description:
      'Завжди 202 — і для відомої адреси, і для невідомої. Лист отримує лише той, '
      + 'хто справді існує й підтвердив пошту. Код живе годину.',
  })
  @ApiResponse({ status: 429, description: 'забагато спроб' })
  forgotPassword(@Body() dto: EmailOnlyDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Post('auth/password/reset')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Задати новий пароль за кодом із листа',
    description: 'Після зміни всі одноразові коди людини гасяться, і надсилається сповіщення.',
  })
  @ApiResponse({ status: 400, description: 'посилання недійсне або пароль не годиться' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Patch('me/password')
  @ApiOperation({
    summary: 'Змінити власний пароль',
    description:
      'Поточний пароль обовʼязковий навіть за чинного токена: токен міг лишитись '
      + 'у чужих руках. Працює для обох ролей.',
  })
  @ApiResponse({ status: 401, description: 'поточний пароль невірний' })
  @ApiResponse({ status: 400, description: 'новий пароль не годиться' })
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: CurrentUserInfo | null) {
    if (!user) throw new UnauthorizedException('потрібен токен');
    return this.auth.changePassword(
      { id: user.id, role: user.role }, dto.currentPassword, dto.newPassword,
    );
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
