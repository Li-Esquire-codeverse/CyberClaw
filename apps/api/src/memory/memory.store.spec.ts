import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from './memory.store';

describe('MemoryStore', () => {
  let root: string;
  let store: MemoryStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cyberclaw-memory-'));
    store = new MemoryStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('首次 appendMemory 自动创建骨架并写入', async () => {
    const res = await store.appendMemory('用户是一名律师');
    expect(res.ok).toBe(true);

    const content = await readFile(join(root, 'MEMORY.md'), 'utf-8');
    expect(content).toContain('# MEMORY');
    expect(content).toContain('- ');
    expect(content).toContain('用户是一名律师');
  });

  it('append 带日期前缀', async () => {
    await store.appendMemory('记住某事实');
    const content = await readFile(join(root, 'MEMORY.md'), 'utf-8');
    // - YYYY-MM-DD 前缀
    expect(content).toMatch(/^- \d{4}-\d{2}-\d{2} 记住某事实$/m);
  });

  it('readMemory 往返一致', async () => {
    await store.appendMemory('第一条');
    await store.appendMemory('第二条');
    const content = await store.readMemory();
    expect(content).toContain('第一条');
    expect(content).toContain('第二条');
  });

  it('空库 readMemory 返回空串（不抛错）', async () => {
    expect(await store.readMemory()).toBe('');
    expect(await store.readUserProfile()).toBe('');
  });

  it('USER.md 读写', async () => {
    const res = await store.appendUserProfile('沟通风格：简洁');
    expect(res.ok).toBe(true);
    const content = await store.readUserProfile();
    expect(content).toContain('沟通风格：简洁');
  });

  it('journal 按日期读写', async () => {
    await store.appendJournal('今天调研了向量检索', '2026-08-21');
    const content = await store.readJournal('2026-08-21');
    expect(content).toContain('向量检索');
    // 不存在的日期返回空串
    expect(await store.readJournal('2020-01-01')).toBe('');
  });

  it('空内容写入返回错误', async () => {
    const res = await store.appendMemory('   ');
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('超长单条内容被截断（不拒绝）', async () => {
    const res = await store.appendMemory('x'.repeat(600));
    expect(res.ok).toBe(true);
    expect(res.truncated).toBe(true);
    const content = await store.readMemory();
    expect(content.length).toBeLessThan(600);
  });

  it('MEMORY.md 超限时拒绝写入（truncated）', async () => {
    // 直接写一个超过上限的文件
    await writeFile(join(root, 'MEMORY.md'), '# MEMORY\n\n' + 'y'.repeat(50_100), 'utf-8');
    const res = await store.appendMemory('这条不该写入');
    expect(res.ok).toBe(false);
    expect(res.truncated).toBe(true);
    const content = await store.readMemory();
    expect(content).not.toContain('这条不该写入');
  });

  it('写队列：并发 10 次 add 不丢数据', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.appendMemory(`并发写入第 ${i} 条`)),
    );
    const content = await store.readMemory();
    for (let i = 0; i < 10; i++) {
      expect(content).toContain(`并发写入第 ${i} 条`);
    }
  });

  it('buildPromptInjection 空库返回 null', async () => {
    expect(await store.buildPromptInjection()).toBeNull();
  });

  it('buildPromptInjection 非空返回 header+body', async () => {
    await store.appendMemory('用户是律师');
    const inj = await store.buildPromptInjection();
    expect(inj).not.toBeNull();
    expect(inj!.header).toContain('长期记忆');
    expect(inj!.body).toContain('用户是律师');
  });

  it('buildPromptInjection 超限截断', async () => {
    await store.appendMemory('z'.repeat(1000));
    // 手动写入超大文件
    await writeFile(join(root, 'MEMORY.md'), '# MEMORY\n\n' + '大'.repeat(20_000), 'utf-8');
    const inj = await store.buildPromptInjection();
    expect(inj).not.toBeNull();
    expect(inj!.body.length).toBeLessThan(8300);
    expect(inj!.body).toContain('记忆过长已截断');
  });

  it('search 命中 MEMORY 内容', async () => {
    await store.appendMemory('项目截止日期是本周五');
    const hits = await store.search('截止日期');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].source).toBe('MEMORY');
    expect(hits[0].text).toContain('截止日期');
  });

  it('search 包含近 N 天 journal（MEMORY_JOURNAL_DAYS 可配）', async () => {
    await store.appendJournal('今天讨论了 embedding 方案', '2026-08-20');
    process.env.MEMORY_JOURNAL_DAYS = '10';
    const hits = await store.search('embedding');
    expect(hits.some((h) => h.source === 'journal')).toBe(true);
    delete process.env.MEMORY_JOURNAL_DAYS;
  });

  it('search 空 query 返回空数组', async () => {
    await store.appendMemory('任意内容');
    expect(await store.search('  ')).toEqual([]);
  });

  it('getStats 返回文件统计', async () => {
    await store.appendMemory('内容一');
    await store.appendJournal('日记内容', '2026-08-20');
    const stats = await store.getStats();
    expect(stats.memoryBytes).toBeGreaterThan(0);
    expect(stats.journalCount).toBeGreaterThanOrEqual(1);
    expect(stats.lastUpdated).toBeTruthy();
  });

  it('pruneJournal 删除过期日记，保留近期', async () => {
    await store.appendJournal('很旧的日记', '2020-01-01');
    await store.appendJournal('昨天的日记', '2026-08-20');
    const removed = await store.pruneJournal(30);
    expect(removed).toBe(1);
    expect(await store.readJournal('2020-01-01')).toBe('');
    expect(await store.readJournal('2026-08-20')).toContain('昨天的日记');
  });

  it('pruneJournal 无 journal 目录时返回 0 不报错', async () => {
    expect(await store.pruneJournal(30)).toBe(0);
  });
});
