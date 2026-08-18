import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** ConversationsStore 注入 token */
export const CONVERSATIONS_STORE = Symbol('CONVERSATIONS_STORE');

/** 会话元数据（与前端 Conversations 列表对应） */
export interface ConversationRecord {
  id: string;
  agentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertConversationInput {
  id: string;
  agentId: string;
  title: string;
}

/**
 * 会话列表存储（SQLite，与 langgraph checkpointer 共用同一 db 文件）。
 *
 * 注意：checkpointer 只持久化对话内容（线程消息），
 * 会话的「列表元数据」（id / 标题 / 时间）由本表单独管理。
 */
export class ConversationsStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '新对话',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_agent
        ON conversations(agent_id, updated_at DESC);
    `);
  }

  /** 按更新时间倒序列出会话（可按智能体过滤） */
  list(agentId?: string): ConversationRecord[] {
    if (agentId) {
      return this.db
        .prepare(
          `SELECT id, agent_id AS agentId, title,
                  created_at AS createdAt, updated_at AS updatedAt
           FROM conversations WHERE agent_id = ?
           ORDER BY updated_at DESC`,
        )
        .all(agentId) as unknown as ConversationRecord[];
    }
    return this.db
      .prepare(
        `SELECT id, agent_id AS agentId, title,
                created_at AS createdAt, updated_at AS updatedAt
         FROM conversations ORDER BY updated_at DESC`,
      )
      .all() as unknown as ConversationRecord[];
  }

  /** 创建或更新（标题变化 / 新消息到来时刷新 updatedAt） */
  upsert(input: UpsertConversationInput): ConversationRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO conversations (id, agent_id, title, created_at, updated_at)
         VALUES (@id, @agentId, @title, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           updated_at = excluded.updated_at`,
      )
      .run({ ...input, createdAt: now, updatedAt: now });
    const row = this.db
      .prepare(
        `SELECT id, agent_id AS agentId, title,
                created_at AS createdAt, updated_at AS updatedAt
         FROM conversations WHERE id = ?`,
      )
      .get(input.id) as unknown as ConversationRecord;
    return row;
  }

  /** 删除会话（返回是否真的删除） */
  remove(id: string): boolean {
    const res = this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    return res.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
