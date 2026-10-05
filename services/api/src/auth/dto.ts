import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';

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
