import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ChatService } from './chat.service';

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}
  private static readonly ROOM_REGEX = /^[a-zA-Z0-9_-]{1,32}$/;

  private parseLimit(value: string | undefined, fallback: number, max: number): number {
    const parsed = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.min(parsed, max);
  }

  @Get('messages')
  @ApiOperation({ summary: 'Get chat messages' })
  @ApiQuery({ name: 'room', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'before', required: false })
  async getMessages(
    @Query('room') room?: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const targetRoom = room && ChatController.ROOM_REGEX.test(room) ? room : 'general';
    const beforeCursor = this.chatService.parseBeforeCursor(before);
    return this.chatService.getMessages(targetRoom, this.parseLimit(limit, 50, 200), beforeCursor);
  }
}
