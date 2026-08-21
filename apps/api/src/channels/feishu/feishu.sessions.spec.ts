import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FeishuSessions } from './feishu.sessions';

describe('FeishuSessions', () => {
  let sessions: FeishuSessions;
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(mkdtempSync(join(tmpdir(), 'cyberclaw-feishu-')), 'test.db');
    sessions = new FeishuSessions(dbPath);
  });

  it('首次 getOrCreate 生成 conv-uuid 并持久化', () => {
    const convId = sessions.getOrCreate('chat-1', 'ag_1');
    expect(convId).toMatch(/^conv-[0-9a-f-]{36}$/);
    // 持久化：新实例（同一 db 文件）可查到
    const sessions2 = new FeishuSessions(dbPath);
    expect(sessions2.get('chat-1')?.conversationId).toBe(convId);
  });

  it('同 chat_id + 同 agent 复用 conversationId', () => {
    const conv1 = sessions.getOrCreate('chat-1', 'ag_1');
    const conv2 = sessions.getOrCreate('chat-1', 'ag_1');
    expect(conv2).toBe(conv1);
  });

  it('agentId 变化时新建 conversationId（各 agent 独立上下文）', () => {
    const conv1 = sessions.getOrCreate('chat-1', 'ag_1');
    const conv2 = sessions.getOrCreate('chat-1', 'ag_2');
    expect(conv2).not.toBe(conv1); // 新 agent → 新会话
    expect(sessions.get('chat-1')?.agentId).toBe('ag_2');
  });

  it('switchAgent 强制新建 conversationId 并更新 agent', () => {
    const conv1 = sessions.getOrCreate('chat-1', 'ag_1');
    const conv2 = sessions.switchAgent('chat-1', 'ag_2');
    expect(conv2).not.toBe(conv1);
    expect(sessions.get('chat-1')?.agentId).toBe('ag_2');
    expect(sessions.get('chat-1')?.conversationId).toBe(conv2);
  });

  it('switchAgent 后同 agent 走 getOrCreate 复用新会话', () => {
    sessions.switchAgent('chat-1', 'ag_2');
    const conv = sessions.getOrCreate('chat-1', 'ag_2');
    expect(conv).toBe(sessions.get('chat-1')?.conversationId);
  });

  it('不同 chat_id 映射到不同会话', () => {
    const c1 = sessions.getOrCreate('chat-1', 'ag_1');
    const c2 = sessions.getOrCreate('chat-2', 'ag_1');
    expect(c1).not.toBe(c2);
  });

  it('不存在的 chat_id 返回 undefined', () => {
    expect(sessions.get('nobody')).toBeUndefined();
  });
});
