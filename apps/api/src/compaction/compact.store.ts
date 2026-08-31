import { ConversationsStore } from '../chat/conversations.store';

/**
 * 压缩摘要存储（Phase 4 C1）：封装 conversations.summary 字段的读写。
 *
 * 设计：摘要持久化到会话表（spec P4「压缩最小侵入」），与 checkpointer
 * 存储解耦；重复压缩请求直接复用库中摘要，避免每次都全量重算（token 浪费）。
 */
export class CompactStore {
  constructor(private readonly conversations: ConversationsStore) {}

  /** 读会话压缩摘要；未压缩过返回 undefined */
  loadSummary(conversationId: string): string | undefined {
    return this.conversations.loadSummary(conversationId);
  }

  /** 写会话压缩摘要（幂等：同一会话只会在首次压缩时写入，见 maybeCompact） */
  saveSummary(conversationId: string, summary: string): void {
    this.conversations.saveSummary(conversationId, summary);
  }
}
