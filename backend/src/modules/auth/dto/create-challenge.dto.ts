import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateChallengeDto {
  @ApiProperty({ example: '7Yj8xw3fD2F9w3qFQ4eV7bQ1m9pN4wQj1n1hQ4vD2c3Z' })
  @IsString()
  @IsNotEmpty()
  wallet: string;
}
