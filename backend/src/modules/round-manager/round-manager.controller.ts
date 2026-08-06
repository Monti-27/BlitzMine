import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RoundManagerService } from './round-manager.service';

@ApiTags('rounds')
@Controller('rounds')
export class RoundManagerController {
  constructor(private readonly roundManagerService: RoundManagerService) {}

  @Get('current')
  @ApiOperation({ summary: 'Get current round' })
  async getCurrentRound() {
    return this.roundManagerService.getCurrentRound();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get round by ID' })
  async getRound(@Param('id', ParseIntPipe) id: number) {
    return this.roundManagerService.getRound(id);
  }
}
