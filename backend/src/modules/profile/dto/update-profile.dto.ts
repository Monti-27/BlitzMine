import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  IsUrl,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'orillions', minLength: 3, maxLength: 20 })
  @IsOptional()
  @IsString()
  @Length(3, 20)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username can contain only letters, numbers, and underscores',
  })
  username?: string;

  @ApiPropertyOptional({ example: 'Competitive miner focused on consistency.' })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  bio?: string;

  @ApiPropertyOptional({ example: 'blitz_alpha' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  xHandle?: string;

  @ApiPropertyOptional({ example: 'alpha_miner' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  telegramHandle?: string;

  @ApiPropertyOptional({ example: 'alpha_miner#1234' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  discordHandle?: string;

  @ApiPropertyOptional({ example: 'https://blitzmine.example/profile/orillions' })
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'website must be a valid URL' })
  @MaxLength(300)
  website?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example/avatar.png' })
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'avatarUrl must be a valid URL' })
  @MaxLength(300)
  avatarUrl?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example/banner.png' })
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'bannerUrl must be a valid URL' })
  @MaxLength(300)
  bannerUrl?: string;
}
