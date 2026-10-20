import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'anya@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'secret123' })
  @IsString() @Length(6, 200)
  password!: string;
}

export class UpdateTimeZoneDto {
  @ApiProperty({ example: 'Europe/Kyiv', description: 'назва зони з бази IANA' })
  @IsString() @Length(1, 64)
  timezone!: string;
}

/**
 * Реєстрація викладача.
 *
 * Пароль тут перевіряється лише на довжину: змістовні вимоги живуть у ядрі
 * (`passwordIssues`) і віддаються списком причин, а не однією відмовою.
 * Дублювати їх анотаціями означало б мати два джерела істини.
 */
export class RegisterDto {
  @ApiProperty({ example: 'Марія Коваль' })
  @IsString() @Length(2, 120)
  name!: string;

  @ApiProperty({ example: 'maria@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'кава з молоком о сьомій', minLength: 12 })
  // Довжину НЕ перевіряємо тут: правило живе в ядрі й віддає перелік причин
  // українською. Тут лишається лише верхня межа — захист від мегабайтного тіла.
  @IsString() @Length(1, 200)
  password!: string;

  @ApiProperty({ example: 'Europe/Kyiv', description: 'назва зони з бази IANA' })
  @IsString() @Length(1, 64)
  timezone!: string;

  @ApiProperty({ required: false, example: 50000, description: 'типова ціна заняття в копійках' })
  @IsOptional() @IsInt() @Min(0)
  priceMinor?: number;
}

/** Повторне надсилання листа підтвердження й запит на відновлення пароля. */
export class EmailOnlyDto {
  @ApiProperty({ example: 'maria@example.com' })
  @IsEmail()
  email!: string;
}

/** Одноразовий код із листа. */
export class TokenDto {
  @ApiProperty({ description: 'код із посилання в листі' })
  @IsString() @Length(16, 200)
  token!: string;
}

export class ResetPasswordDto extends TokenDto {
  @ApiProperty({ example: 'нова довга фраза 2026', minLength: 12 })
  @IsString() @Length(1, 200)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'поточний пароль — обовʼязковий навіть за чинного токена' })
  @IsString() @Length(1, 200)
  currentPassword!: string;

  @ApiProperty({ example: 'нова довга фраза 2026', minLength: 12 })
  @IsString() @Length(1, 200)
  newPassword!: string;
}
