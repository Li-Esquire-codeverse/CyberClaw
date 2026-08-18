import { Module } from '@nestjs/common';
import { ClawModule } from '../claw/claw.module';
import { ChatController } from './chat.controller';
import { ChatService, CHAT_CHECKPOINTER } from './chat.service';

/**
 * AI 助手对话模块：读取 CyberClaw 配置 + langchain createAgent，
 * 提供 SSE 流式对话接口。
 *
 * CHAT_CHECKPOINTER 默认为 MemorySaver（进程内对话记忆）；
 * 需要重启持久化时可注入 SqliteSaver（见 chat.service）。
 */
@Module({
  imports: [ClawModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    // 对话记忆存储：此处可替换为 SqliteSaver 等持久化实现
    { provide: CHAT_CHECKPOINTER, useValue: undefined },
  ],
  exports: [ChatService],
})
export class ChatModule {}
