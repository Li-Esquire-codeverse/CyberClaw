import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

/**
 * 调度任务持久化（SQLite，与 conversations / feishu_sessions 同库）。
 *
 * schedules：at（一次性）/ every（固定间隔）任务定义
 * schedule_runs：执行历史
 */
export interface ScheduleRecord {
  id: string;
  type: 'at' | 'every';
  /** at: ISO 时间串；every: 间隔描述（如 '3600s' / '5m' / '2h'） */
  cron: string;
  /** JSON 字符串：{ agentId?, prompt, pushTo? } */
  payload: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleRun {
  id: string;
  scheduleId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'ok' | 'error';
  output?: string;
}

export interface SchedulePayload {
  agentId?: string;
  prompt: string;
  pushTo?: 'feishu';
  /** pushTo='feishu' 时的推送目标会话（chat_id） */
  chatId?: string;
}

const TYPE_RE = /^(at|every)$/;
/** every 间隔描述：数字 + s/m/h/d 后缀（如 10s / 5m / 2h / 1d） */
const EVERY_RE = /^\d+\s*[smhd]$/;

export function parseEverySeconds(cron: string): number | undefined {
  const m = EVERY_RE.exec(cron.trim());
  if (!m) return undefined;
  const value = Number.parseInt(m[0], 10);
  const unit = m[0].replace(/\d/g, '').trim();
  const mult =
    unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86_400;
  return value * mult;
}

export class ScheduleStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('at','every')),
        cron TEXT NOT NULL,
        payload TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schedule_runs (
        id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        output TEXT
      );
    `);
  }

  list(): ScheduleRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, type, cron, payload, enabled, created_at, updated_at
         FROM schedules ORDER BY updated_at DESC`,
      )
      .all() as Array<{
      id: string;
      type: 'at' | 'every';
      cron: string;
      payload: string;
      enabled: number;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      cron: r.cron,
      payload: r.payload,
      enabled: r.enabled === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  get(id: string): ScheduleRecord | undefined {
    return this.list().find((s) => s.id === id);
  }

  create(input: {
    type: 'at' | 'every';
    cron: string;
    payload: string;
  }): ScheduleRecord {
    const type = input.type;
    if (!TYPE_RE.test(type)) {
      throw new Error(`无效的调度类型: ${type}（可选 at/every）`);
    }
    if (type === 'every' && parseEverySeconds(input.cron) === undefined) {
      throw new Error(`无效的 every 间隔: ${input.cron}（格式如 10s / 5m / 2h）`);
    }
    if (type === 'at' && Number.isNaN(Date.parse(input.cron))) {
      throw new Error(`无效的 at 时间: ${input.cron}（需要 ISO 时间串）`);
    }
    let parsed: SchedulePayload | undefined;
    try {
      parsed = JSON.parse(input.payload) as SchedulePayload;
    } catch {
      throw new Error('payload 不是合法 JSON');
    }
    if (!parsed || typeof parsed.prompt !== 'string' || !parsed.prompt.trim()) {
      throw new Error('payload 缺少 prompt（要 agent 执行的内容）');
    }

    const now = new Date().toISOString();
    const record: ScheduleRecord = {
      id: `sch-${randomUUID()}`,
      type,
      cron: input.cron.trim(),
      payload: input.payload,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO schedules (id, type, cron, payload, enabled, created_at, updated_at)
         VALUES (@id, @type, @cron, @payload, 1, @createdAt, @updatedAt)`,
      )
      .run({
        id: record.id,
        type: record.type,
        cron: record.cron,
        payload: record.payload,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    return record;
  }

  remove(id: string): boolean {
    const info = this.db
      .prepare('DELETE FROM schedules WHERE id = ?')
      .run(id);
    return info.changes > 0;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const info = this.db
      .prepare('UPDATE schedules SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, new Date().toISOString(), id);
    return info.changes > 0;
  }

  recordRunStart(scheduleId: string): ScheduleRun {
    const run: ScheduleRun = {
      id: `run-${randomUUID()}`,
      scheduleId,
      startedAt: new Date().toISOString(),
      status: 'running',
    };
    this.db
      .prepare(
        `INSERT INTO schedule_runs (id, schedule_id, started_at, status)
         VALUES (@id, @scheduleId, @startedAt, 'running')`,
      )
      .run({
        id: run.id,
        scheduleId,
        startedAt: run.startedAt,
      });
    return run;
  }

  recordRunFinish(runId: string, status: 'ok' | 'error', output?: string): void {
    this.db
      .prepare(
        `UPDATE schedule_runs
         SET status = ?, finished_at = ?, output = ?
         WHERE id = ?`,
      )
      .run(status, new Date().toISOString(), output ?? null, runId);
  }

  listRuns(scheduleId?: string, limit = 20): ScheduleRun[] {
    const rows = this.db
      .prepare(
        `SELECT id, schedule_id, started_at, finished_at, status, output
         FROM schedule_runs
         ${scheduleId ? 'WHERE schedule_id = ?' : ''}
         ORDER BY started_at DESC LIMIT ?`,
      )
      .all(...(scheduleId ? [scheduleId, limit] : [limit])) as Array<{
      id: string;
      schedule_id: string;
      started_at: string;
      finished_at: string | null;
      status: 'running' | 'ok' | 'error';
      output: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      scheduleId: r.schedule_id,
      startedAt: r.started_at,
      finishedAt: r.finished_at ?? undefined,
      status: r.status,
      output: r.output ?? undefined,
    }));
  }
}
