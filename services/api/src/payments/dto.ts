import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Length, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePaymentDto {
  @ApiProperty({
    example: 100000,
    description: 'сума в КОПІЙКАХ, цілим додатним числом (monobank приймає так само)',
  })
  @Type(() => Number) @IsInt() @Min(10_000)
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
