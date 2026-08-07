import { Module, Global } from '@nestjs/common';
import { WebSocketService } from './websocket.service';
import { ChatModule } from '../chat/chat.module';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [ChatModule, AuthModule],
  providers: [WebSocketService],
  exports: [WebSocketService],
})
export class WebSocketModule {}
