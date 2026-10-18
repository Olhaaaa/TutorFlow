import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateStudentDto {
  @ApiProperty({ example: 'Аня' })
  @IsString() @Length(1, 120)
  name!: string;

  @ApiProperty({ example: 'anya@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Europe/Kyiv', description: 'назва зони з бази IANA' })
  @IsString() @Length(1, 64)
  timezone!: string;

  @ApiProperty({ example: 'тимчасовий пароль' })
  @IsString() @Length(6, 200)
  password!: string;
}

export class TopupDto {
  @ApiProperty({ example: 200000, description: 'сума в КОПІЙКАХ, цілим додатним числом' })
  @Type(() => Number) @IsInt() @Min(1)
  amountMinor!: number;

  @ApiPropertyOptional({ example: 'оплата за 4 заняття' })
  @IsOptional() @IsString() @Length(0, 300)
  comment?: string;
}

export class HistoryQueryDto {
  /**
   * Напрямок руху коштів. `all` стандартно, тому адреса без параметра
   * поводиться рівно так, як поводилась історія всередині `/balance`.
   */
  @ApiPropertyOptional({ enum: ['all', 'in', 'out'], default: 'all' })
  @IsOptional() @IsIn(['all', 'in', 'out'])
  direction?: 'all' | 'in' | 'out';
}
