import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Length, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePaymentDto {
  @ApiProperty({
    example: 100000,
    minimum: 100,
    description:
      'сума в КОПІЙКАХ, цілим додатним числом (monobank приймає так само); '
      + 'мінімум — 100, тобто 1 ₴',
  })
  @Type(() => Number) @IsInt() @Min(100)
  amountMinor!: number;
}

export class ConnectPaymentsDto {
  @ApiProperty({
    example: 'uZ…',
    description: 'токен еквайрингу з кабінету провайдера; зберігається зашифрованим',
  })
  @IsString() @Length(10, 200)
  token!: string;
}
