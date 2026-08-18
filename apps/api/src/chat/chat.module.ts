import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ClawModule } from '../claw/claw.module';
import { findRepoRoot } from '@cyberclaw/agent-core';
import { ChatController } from './chat.controller';
import { ChatService, CHAT_CHECKPOINTER } from './chat.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsStore, CONVERSATIONS_STORE } from './conversations.store';

/**
 * AI 助手对话模块：读取 CyberClaw 配置 + langchain createAgent，
 * 提供 SSE 流式对话接口。
 *
 * 数据持久化（对话记忆 + 会话列表）统一存放在仓库根 data/cyberclaw.db：
 *  - checkpointer 表（checkpoints）：langgraph 线程消息
 *  - conversations 表：会话列表元数据
 */
const dbPathOf = (): string => {
  const root = findRepoRoot(process.cwd()) ?? process.cwd();
  return join(root, 'data', 'cyberclaw.db');
};

@Module({
  imports: [ClawModule],
  controllers: [ChatController, ConversationsController],
  providers: [
    ChatService,
    {
      provide: CHAT_CHECKPOINTER,
      useFactory: () => {
        const path = dbPathOf();
        if (!existsSync(dirname(path))) {
          mkdirSync(dirname(path), { recursive: true });
        }
        // SqliteSaver：SQLite 持久化，重启后对话记忆不丢失
        return SqliteSaver.fromConnString(path);
      },
    },
    {
      provide: CONVERSATIONS_STORE,
      useFactory: () => new ConversationsStore(dbPathOf()),
    },
  ],
  exports: [ChatService],
})
export class ChatModule implements OnModuleDestroy {
  constructor(
    @Inject(CONVERSATIONS_STORE)
    private readonly conversationsStore: ConversationsStore,
  ) {}

  onModuleDestroy(): void {
    // 释放 SQLite 连接（better-sqlite3 为同步接口，进程退出时安全关闭）
    this.conversationsStore.close();
  }
}
