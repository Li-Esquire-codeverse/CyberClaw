import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../memory/memory.store';
import { createMemoryExecutor } from './memory.executor';

describe('memoryExecutor', () => {
  let root: string;
  let store: MemoryStore;
  let executor: (args: Record<string, unknown>) => Promise<string>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cyberclaw-mexec-'));
    store = new MemoryStore(root);
    executor = createMemoryExecutor(store);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('缺少 operation 参数时返回工具错误', async () => {
    const result = await executor({ text: 'x' });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('operation');
  });

  it('add 缺少 text 返回工具错误', async () => {
    const result = await executor({ operation: 'add' });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('text');
  });

  it('add 成功写入并返回"已记住"', async () => {
    const result = await executor({
      operation: 'add',
      text: '用户是一名律师',
    });
    expect(result).toContain('已记住');
    expect(result).toContain('律师');
    expect(await store.readMemory()).toContain('用户是一名律师');
  });

  it('add target=user 写入画像', async () => {
    const result = await executor({
      operation: 'add',
      target: 'user',
      text: '沟通风格简洁',
    });
    expect(result).toContain('已记住');
    expect(await store.readUserProfile()).toContain('沟通风格简洁');
  });

  it('add 超长文本截断提示', async () => {
    const result = await executor({ operation: 'add', text: 'x'.repeat(600) });
    expect(result).toContain('已截断');
  });

  it('search 命中此前 add 的内容并格式化', async () => {
    await executor({ operation: 'add', text: '项目截止日期是本周五' });
    const result = await executor({
      operation: 'search',
      query: '截止日期',
    });
    expect(result).toContain('1. [记忆]');
    expect(result).toContain('截止日期');
    expect(result).not.toContain('[工具错误]');
  });

  it('search 缺少 query 返回工具错误', async () => {
    const result = await executor({ operation: 'search' });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('query');
  });

  it('search 无命中返回提示（非工具错误）', async () => {
    const result = await executor({
      operation: 'search',
      query: '量子计算机',
    });
    expect(result).toContain('未找到');
    expect(result).not.toContain('[工具错误]');
  });

  it('search limit 生效', async () => {
    for (let i = 0; i < 3; i++) {
      await store.appendMemory(`用户偏好话题 ${i}`);
    }
    const result = await executor({
      operation: 'search',
      query: '话题',
      limit: 2,
    });
    expect(result.split('\n\n').length).toBe(2);
  });

  it('list 返回统计概览', async () => {
    await executor({ operation: 'add', text: '一条记忆' });
    const result = await executor({ operation: 'list' });
    expect(result).toContain('MEMORY.md');
    expect(result).toContain('1 条');
  });

  it('不支持的 operation 返回工具错误', async () => {
    const result = await executor({ operation: 'delete-all' });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('delete-all');
  });

  it('store 抛错时返回工具错误（不逃逸异常）', async () => {
    // 用一个会抛错的 store
    const broken = {
      appendMemory: async () => {
        throw new Error('磁盘已满');
      },
      readMemory: async () => '',
      readUserProfile: async () => '',
      search: async () => [],
      getStats: async () => ({ memoryBytes: 0, userBytes: 0, journalCount: 0 }),
    } as unknown as MemoryStore;
    const brokenExecutor = createMemoryExecutor(broken);
    const result = await brokenExecutor({ operation: 'add', text: 'x' });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('磁盘已满');
  });
});
