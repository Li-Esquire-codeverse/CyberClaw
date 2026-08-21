import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEverySeconds, ScheduleStore } from './schedule.store';

describe('parseEverySeconds', () => {
  it('parseEverySeconds 解析秒/分/小时', () => {
    expect(parseEverySeconds('10s')).toBe(10);
    expect(parseEverySeconds('5m')).toBe(300);
    expect(parseEverySeconds('2h')).toBe(7200);
    expect(parseEverySeconds('1d')).toBe(86400);
  });

  it('非法格式返回 undefined', () => {
    expect(parseEverySeconds('10')).toBeUndefined();
    expect(parseEverySeconds('xs')).toBeUndefined();
    expect(parseEverySeconds('10w')).toBeUndefined();
    expect(parseEverySeconds('')).toBeUndefined();
  });
});

describe('ScheduleStore', () => {
  let store: ScheduleStore;
  let dbPath: string;

  const payload = JSON.stringify({
    agentId: 'ag_1',
    prompt: '提醒用户喝水',
    pushTo: 'feishu',
  });

  beforeEach(() => {
    dbPath = join(mkdtempSync(join(tmpdir(), 'cyberclaw-sched-')), 'test.db');
    store = new ScheduleStore(dbPath);
  });

  it('create 生成 id 并持久化（新实例可查）', () => {
    const rec = store.create({ type: 'every', cron: '10s', payload });
    expect(rec.id).toMatch(/^sch-/);
    expect(rec.enabled).toBe(true);
    const store2 = new ScheduleStore(dbPath);
    expect(store2.get(rec.id)).toMatchObject({ type: 'every', cron: '10s' });
  });

  it('create 非法类型拒绝', () => {
    expect(() =>
      store.create({ type: 'cron' as never, cron: '10s', payload }),
    ).toThrow('无效的调度类型');
  });

  it('create every 非法间隔拒绝', () => {
    expect(() =>
      store.create({ type: 'every', cron: 'abc', payload }),
    ).toThrow('无效的 every 间隔');
  });

  it('create at 非法时间拒绝', () => {
    expect(() =>
      store.create({ type: 'at', cron: 'not-a-time', payload }),
    ).toThrow('无效的 at 时间');
  });

  it('create payload 非法 JSON 拒绝', () => {
    expect(() =>
      store.create({ type: 'at', cron: '2030-01-01T00:00:00Z', payload: 'x' }),
    ).toThrow('payload 不是合法 JSON');
  });

  it('create payload 缺 prompt 拒绝', () => {
    expect(() =>
      store.create({
        type: 'at',
        cron: '2030-01-01T00:00:00Z',
        payload: JSON.stringify({ pushTo: 'feishu' }),
      }),
    ).toThrow('缺少 prompt');
  });

  it('list 按更新时间倒序', () => {
    const a = store.create({ type: 'every', cron: '10s', payload });
    const b = store.create({ type: 'every', cron: '20s', payload });
    expect(store.list().map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it('remove 返回是否删除', () => {
    const rec = store.create({ type: 'every', cron: '10s', payload });
    expect(store.remove(rec.id)).toBe(true);
    expect(store.remove(rec.id)).toBe(false);
  });

  it('setEnabled 更新状态', () => {
    const rec = store.create({ type: 'every', cron: '10s', payload });
    expect(store.setEnabled(rec.id, false)).toBe(true);
    expect(store.get(rec.id)?.enabled).toBe(false);
  });

  it('运行记录：start → finish，listRuns 可查', () => {
    const rec = store.create({ type: 'every', cron: '10s', payload });
    const run = store.recordRunStart(rec.id);
    store.recordRunFinish(run.id, 'ok', '执行结果');
    const runs = store.listRuns(rec.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'ok', output: '执行结果' });
    expect(runs[0].finishedAt).toBeTruthy();
  });

  it('listRuns 限制条数', () => {
    const rec = store.create({ type: 'every', cron: '10s', payload });
    for (let i = 0; i < 3; i++) {
      const run = store.recordRunStart(rec.id);
      store.recordRunFinish(run.id, 'ok');
    }
    expect(store.listRuns(rec.id, 2)).toHaveLength(2);
  });
});
