import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

/**
 * 飞书 chat_id ↔ CyberClaw conversationId 持久化映射（SQLite）。
 *
 * 同一飞书会话（单聊/群聊按 chat_id 区分）固定映射到同一个 conversationId，
 * 保证连续对话上下文连贯（thread_id 复用）；agentId 变化时更新映射。
 */
export interface FeishuSession {
  chatId: string;
  conversationId: string;
  agentId: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeishuSessionStore {
  get(chatId: string): FeishuSession | undefined;
  upsert(session: FeishuSession): void;
  /** 获取或创建映射：返回 conversationId */
  getOrCreate(chatId: string, agentId: string): string;
}

/** 基于 better-sqlite3 的持久化实现（与 conversations 同库文件） */
export class FeishuSessions implements FeishuSessionStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feishu_sessions (
        chat_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  get(chatId: string): FeishuSession | undefined {
    const row = this.db
      .prepare(
        `SELECT chat_id, conversation_id, agent_id, created_at, updated_at
         FROM feishu_sessions WHERE chat_id = ?`,
      )
      .get(chatId) as
      | {
          chat_id: string;
          conversation_id: string;
          agent_id: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      chatId: row.chat_id,
      conversationId: row.conversation_id,
      agentId: row.agent_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  upsert(session: FeishuSession): void {
    this.db
      .prepare(
        `INSERT INTO feishu_sessions (chat_id, conversation_id, agent_id, created_at, updated_at)
         VALUES (@chatId, @conversationId, @agentId, @createdAt, @updatedAt)
         ON CONFLICT(chat_id) DO UPDATE SET
           conversation_id = @conversationId,
           agent_id = @agentId,
           updated_at = @updatedAt`,
      )
      .run(session);
  }

  /** 获取或创建会话映射：返回 conversationId */
  getOrCreate(chatId: string, agentId: string): string {
    const existing = this.get(chatId);
    const now = new Date().toISOString();
    if (existing && existing.agentId === agentId) {
      return existing.conversationId;
    }
    const conversationId = existing?.conversationId ?? `conv-${randomUUID()}`;
    this.upsert({
      chatId,
      conversationId,
      agentId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return conversationId;
  }
}
