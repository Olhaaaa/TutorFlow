import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CalendarQueryDto {
  @ApiProperty({ example: '2026-10-19T00:00:00Z', description: 'початок періоду, ISO 8601 в UTC' })
  @IsISO8601()
  from!: string;

  @ApiProperty({ example: '2026-10-26T00:00:00Z' })
  @IsISO8601()
  to!: string;
}

export class AvailabilityRuleDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 — неділя, як у PostgreSQL extract(dow)' })
  @Type(() => Number) @IsInt() @Min(0) @Max(6)
  weekday!: number;

  @ApiProperty({ example: '16:00', description: 'ЛОКАЛЬНИЙ настінний час викладача' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'очікується формат HH:MM' })
  startTime!: string;

  @ApiProperty({ example: 60 })
  @Type(() => Number) @IsInt() @Min(15) @Max(480)
  durationMin!: number;

  @ApiProperty({ example: 50000, description: 'ціна в КОПІЙКАХ, цілим числом' })
  @Type(() => Number) @IsInt() @Min(0)
  priceMinor!: number;
}

export class EnrollmentDto {
  @ApiProperty({ example: 3 })
  @Type(() => Number) @IsInt() @Min(1)
  studentId!: number;

  @ApiProperty({ minimum: 0, maximum: 6 })
  @Type(() => Number) @IsInt() @Min(0) @Max(6)
  weekday!: number;

  @ApiProperty({ example: '16:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'очікується формат HH:MM' })
  startTime!: string;
}

export class ExternalBusyDto {
  @ApiProperty({ example: '2026-10-20T09:00:00Z', description: 'початок, ISO 8601 в UTC' })
  @IsISO8601()
  startAt!: string;

  @ApiProperty({ example: '2026-10-20T11:30:00Z' })
  @IsISO8601()
  endAt!: string;

  @ApiPropertyOptional({ example: 'Лікар', description: 'для себе; студент цього не бачить' })
  @IsOptional() @IsString() @MaxLength(200)
  title?: string;
}

export class GenerateDto {
  @ApiPropertyOptional({ default: 4, description: 'на скільки тижнів уперед' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(26)
  weeks?: number;
}
