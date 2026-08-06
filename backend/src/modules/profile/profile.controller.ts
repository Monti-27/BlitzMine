import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { isValidSolanaAddress } from '../../utils/validation';
import { AuthRequestLike } from '../auth/auth.types';
import { AuthGuard } from '../auth/guards/auth.guard';
import { HoverBatchDto } from './dto/hover-batch.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';

@ApiTags('profiles')
@Controller('profiles')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  private assertValidWallet(wallet: string) {
    if (!isValidSolanaAddress(wallet)) {
      throw new BadRequestException('Invalid Solana wallet address');
    }
  }

  @Get('by-username/:username/hover')
  @ApiOperation({ summary: 'Get lightweight profile card by username' })
  async getHoverByUsername(@Param('username') username: string) {
    const hover = await this.profileService.getProfileHoverByUsername(username);
    if (!hover) {
      throw new NotFoundException('Profile not found');
    }
    return hover;
  }

  @Post('hover/batch')
  @ApiOperation({ summary: 'Get lightweight profile cards for multiple wallets' })
  async getHoverBatch(@Body() body: HoverBatchDto) {
    const wallets: string[] = [];
    const seen = new Set<string>();

    for (const raw of body.wallets) {
      const wallet = raw.trim();
      if (!isValidSolanaAddress(wallet)) {
        throw new BadRequestException(`Invalid Solana wallet address: ${wallet}`);
      }
      if (!seen.has(wallet)) {
        seen.add(wallet);
        wallets.push(wallet);
      }
    }

    if (wallets.length === 0) {
      return { profiles: [] };
    }

    const profiles = await this.profileService.getProfileHoverBatch(wallets);
    return { profiles };
  }

  @Get(':wallet/hover')
  @ApiOperation({ summary: 'Get lightweight profile card for chat hover' })
  async getHover(@Param('wallet') wallet: string) {
    this.assertValidWallet(wallet);
    return this.profileService.getProfileHover(wallet);
  }

  @Get(':wallet')
  @ApiOperation({ summary: 'Get full public profile' })
  async getPublicProfile(@Param('wallet') wallet: string) {
    this.assertValidWallet(wallet);
    return this.profileService.getPublicProfile(wallet);
  }

  @Get('me/view')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get my full profile' })
  async getMyProfile(@Req() req: AuthRequestLike) {
    const wallet = req.auth?.wallet;
    if (!wallet) {
      throw new BadRequestException('Missing authenticated wallet');
    }
    return this.profileService.getPublicProfile(wallet);
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Update my profile metadata' })
  async updateMyProfile(
    @Req() req: AuthRequestLike,
    @Body() body: UpdateProfileDto,
  ) {
    const wallet = req.auth?.wallet;
    if (!wallet) {
      throw new BadRequestException('Missing authenticated wallet');
    }
    return this.profileService.updateProfile(wallet, body);
  }
}
