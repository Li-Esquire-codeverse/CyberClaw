import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationsStore } from './conversations.store';

describe('ConversationsStore', () => {
  let dir: string;
  let store: ConversationsStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cyberclaw-conv-'));
    store = new ConversationsStore(join(dir, 'test.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('upsert 创建并更新会话（标题、时间刷新）', () => {
    const created = store.upsert({ id: 'c1', agentId: 'ag_1', title: '新对话' });
    expect(created.id).toBe('c1');
    expect(created.title).toBe('新对话');

    const updated = store.upsert({ id: 'c1', agentId: 'ag_1', title: '关于深圳的问题' });
    expect(updated.title).toBe('关于深圳的问题');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );
  });

  it('list 按更新时间倒序并按智能体过滤', () => {
    store.upsert({ id: 'c1', agentId: 'ag_1', title: '旧会话' });
    store.upsert({ id: 'c2', agentId: 'ag_1', title: '新会话' });
    store.upsert({ id: 'c3', agentId: 'ag_2', title: '另一个智能体' });

    const all = store.list();
    expect(all.map((c) => c.id)).toEqual(['c3', 'c2', 'c1']); // 倒序（后插入在前）

    const byAgent = store.list('ag_1');
    expect(byAgent.map((c) => c.id)).toEqual(['c2', 'c1']);
  });

  it('remove 删除记录并返回是否成功', () => {
    store.upsert({ id: 'c1', agentId: 'ag_1', title: 'x' });
    expect(store.remove('c1')).toBe(true);
    expect(store.remove('c1')).toBe(false);
    expect(store.list()).toHaveLength(0);
  });
});
