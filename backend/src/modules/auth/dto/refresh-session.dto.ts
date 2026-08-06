import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshSessionDto {
  @ApiProperty({
    example: '0af8f4c8-8f19-4894-b6cc-0ef6a46ec9f1.dS5mY2F...',
    description: 'Opaque refresh token',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
