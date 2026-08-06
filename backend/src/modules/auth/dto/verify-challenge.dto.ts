import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyChallengeDto {
  @ApiProperty({ example: '7Yj8xw3fD2F9w3qFQ4eV7bQ1m9pN4wQj1n1hQ4vD2c3Z' })
  @IsString()
  @IsNotEmpty()
  wallet: string;

  @ApiProperty({ example: 'cm6z8xjch0001w7j4a4ez8whg' })
  @IsString()
  @IsNotEmpty()
  challengeId: string;

  @ApiProperty({ example: '4n1Bd...base58-signature...' })
  @IsString()
  @IsNotEmpty()
  signature: string;
}
