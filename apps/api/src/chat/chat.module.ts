import { Module } from '@nestjs/common';
import { ClawModule } from '../claw/claw.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

/**
 * AI 助手对话模块：读取 CyberClaw 配置 + langchain createAgent，
 * 提供 SSE 流式对话接口。
 */
@Module({
  imports: [ClawModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
