import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsString,
} from 'class-validator';

export class HoverBatchDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: 100,
    example: ['2ZnPv2UEkNxtt4V79vpyPJnV8fQLECjfwvzzEEKGWUZW'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  wallets!: string[];
}
