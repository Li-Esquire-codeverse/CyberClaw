import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { findMonorepoRoot } from '../claw/config-path';
import { searchTexts, type SearchEntry } from './search';
import type { AppendResult, MemoryStats, SearchHit } from './memory.types';

/**
 * 长期记忆存储层：读写 data/memory/ 下的 Markdown 文件。
 *
 *   data/memory/
 *   ├── MEMORY.md             长期记忆（注入 systemPrompt）
 *   ├── USER.md               用户画像（注入 systemPrompt）
 *   └── journal/YYYY-MM-DD.md 日记（工作记忆，search 检索范围）
 *
 * 关键规则：
 *   - 路径安全：日期/文件名全部代码生成，不接受用户输入拼接
 *   - 上限：MAX_MEMORY_BYTES 超限拒绝写入；MAX_APPEND_CHARS 单条截断
 *   - 并发：写操作串行入链（Promise 队列），多请求不互相覆盖
 *   - 自动创建：首次写入自动 mkdir + 生成 MEMORY.md 骨架
 */
const MAX_MEMORY_BYTES = 50_000;
const MAX_APPEND_CHARS = 500;
const MAX_INJECT_CHARS = 8000;
const DEFAULT_JOURNAL_DAYS = 3;

/** Nest 注入 token：全应用共享同一 MemoryStore 实例（写队列统一） */
export const MEMORY_STORE = Symbol('MEMORY_STORE');

function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function journalDays(): number {
  const raw = Number(process.env.MEMORY_JOURNAL_DAYS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_JOURNAL_DAYS;
}

async function safeStat(path: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const s = await stat(path);
    return { size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

export class MemoryStore {
  private readonly root: string;
  /** 写操作串行链：所有写通过 enqueueWrite 排队，读不排队 */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(rootDir?: string) {
    this.root = rootDir ?? resolve(findMonorepoRoot() ?? process.cwd(), 'data', 'memory');
  }

  getRoot(): string {
    return this.root;
  }

  private memoryPath(): string {
    return join(this.root, 'MEMORY.md');
  }

  private userPath(): string {
    return join(this.root, 'USER.md');
  }

  private journalDir(): string {
    return join(this.root, 'journal');
  }

  private journalPath(date: string): string {
    return join(this.journalDir(), `${date}.md`);
  }

  /** 串行化写操作；错误透传给调用方，但不打断后续排队任务 */
  private enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(task);
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async readFileSafe(path: string): Promise<string> {
    try {
      return await readFile(path, 'utf-8');
    } catch {
      return '';
    }
  }

  /** 读 MEMORY.md（不存在返回空串） */
  async readMemory(): Promise<string> {
    return this.readFileSafe(this.memoryPath());
  }

  /** 读 USER.md（不存在返回空串） */
  async readUserProfile(): Promise<string> {
    return this.readFileSafe(this.userPath());
  }

  /** 追加长期记忆（带日期前缀；超限拒绝；单条超长截断） */
  appendMemory(text: string): Promise<AppendResult> {
    return this.enqueueWrite(() => this.appendTo(text, this.memoryPath(), 'MEMORY'));
  }

  /** 追加用户画像 */
  appendUserProfile(text: string): Promise<AppendResult> {
    return this.enqueueWrite(() => this.appendTo(text, this.userPath(), 'USER'));
  }

  /** 追加日记（默认今天） */
  appendJournal(text: string, date?: string): Promise<AppendResult> {
    const day = date ?? localDate();
    return this.enqueueWrite(() => this.appendTo(text, this.journalPath(day), 'journal'));
  }

  /** 读指定日期日记（默认今天） */
  readJournal(date?: string): Promise<string> {
    return this.readFileSafe(this.journalPath(date ?? localDate()));
  }

  private async appendTo(
    text: string,
    file: string,
    kind: 'MEMORY' | 'USER' | 'journal',
  ): Promise<AppendResult> {
    const content = String(text ?? '').trim();
    if (!content) {
      return { ok: false, bytes: 0, error: '内容为空' };
    }
    await mkdir(dirname(file), { recursive: true });

    const before = await safeStat(file);
    // 首次写入生成骨架（仅 MEMORY.md）
    if (!before && kind === 'MEMORY') {
      await writeFile(file, '# MEMORY\n\n', 'utf-8');
    }

    // MEMORY.md 上限检查：超限拒绝（防止无限膨胀撑爆注入上下文）
    if (kind === 'MEMORY') {
      const current = (await safeStat(file))?.size ?? 0;
      if (current >= MAX_MEMORY_BYTES) {
        return {
          ok: false,
          bytes: 0,
          truncated: true,
          error: `记忆已满（>${MAX_MEMORY_BYTES / 1000}KB），请先整理 MEMORY.md`,
        };
      }
    }

    const limited =
      content.length > MAX_APPEND_CHARS
        ? content.slice(0, MAX_APPEND_CHARS)
        : content;
    const line = `- ${localDate()} ${limited}\n`;
    await appendFile(file, line, 'utf-8');
    return {
      ok: true,
      bytes: Buffer.byteLength(line, 'utf-8'),
      truncated: limited.length !== content.length,
    };
  }

  /**
   * 构建 systemPrompt 注入块。
   * 空记忆返回 null（调用方不注入）；非空返回 {header, body}，合计超限截断。
   */
  async buildPromptInjection(): Promise<{ header: string; body: string } | null> {
    const [memory, user] = await Promise.all([
      this.readMemory(),
      this.readUserProfile(),
    ]);
    const memoryBody = memory.trim();
    const userBody = user.trim();
    if (!memoryBody && !userBody) return null;

    const header = '【长期记忆】以下是关于用户的信息，回答时优先参考：';
    let body = '';
    if (memoryBody) body += memoryBody;
    if (userBody) body += `${body ? '\n\n' : ''}【用户画像】\n${userBody}`;
    if (body.length > MAX_INJECT_CHARS) {
      body = `${body.slice(0, MAX_INJECT_CHARS)}\n（记忆过长已截断）`;
    }
    return { header, body };
  }

  /**
   * 关键词检索：MEMORY.md + USER.md + 近 N 天 journal。
   * N 由 MEMORY_JOURNAL_DAYS 环境变量控制（默认 3）。
   */
  async search(
    query: string,
    opts?: { limit?: number; includeJournalDays?: number },
  ): Promise<SearchHit[]> {
    const q = String(query ?? '').trim();
    if (!q) return [];
    const limit = opts?.limit ?? 5;
    const days = opts?.includeJournalDays ?? journalDays();

    const entries: SearchEntry[] = [];
    const [memory, user] = await Promise.all([
      this.readMemory(),
      this.readUserProfile(),
    ]);
    if (memory.trim()) entries.push({ source: 'MEMORY', text: memory });
    if (user.trim()) entries.push({ source: 'USER', text: user });

    for (let i = 0; i < days; i++) {
      const day = localDate(i);
      const txt = await this.readJournal(day);
      if (txt.trim()) entries.push({ source: 'journal', date: day, text: txt });
    }
    return searchTexts(entries, q, limit);
  }

  /** 记忆统计（调试接口用） */
  async getStats(): Promise<MemoryStats> {
    const [memory, user, journalFiles] = await Promise.all([
      safeStat(this.memoryPath()),
      safeStat(this.userPath()),
      safeReaddir(this.journalDir()),
    ]);
    const lastUpdated = [memory?.mtimeMs, user?.mtimeMs]
      .filter((v): v is number => typeof v === 'number')
      .reduce((a, b) => Math.max(a, b), 0);
    return {
      memoryBytes: memory?.size ?? 0,
      userBytes: user?.size ?? 0,
      journalCount: journalFiles.filter((f) => f.endsWith('.md')).length,
      lastUpdated: lastUpdated > 0 ? new Date(lastUpdated).toISOString() : undefined,
    };
  }
}

/** 默认单例：定位到仓库根 data/memory；测试请 new MemoryStore(临时目录) */
export const defaultMemoryStore = new MemoryStore();
