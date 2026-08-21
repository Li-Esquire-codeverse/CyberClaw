import { Test } from '@nestjs/testing';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScheduleController } from './schedule.controller';
import { SCHEDULE_STORE, ScheduleService } from './schedule.service';
import { ScheduleStore } from './schedule.store';
import { ChatService } from '../chat/chat.service';
import { ClawConfigService } from '../claw/claw-config.service';
import { FeishuBotService } from '../channels/feishu/feishu.bot';

describe('ScheduleController', () => {
  let controller: ScheduleController;
  let store: ScheduleStore;
  let service: ScheduleService;

  beforeEach(async () => {
    store = new ScheduleStore(
      join(mkdtempSync(join(tmpdir(), 'cyberclaw-ctrl-')), 'test.db'),
    );
    const chatService = {
      buildAgent: jest.fn(),
      streamChat: jest.fn(),
    };
    const configService = { loadConfig: jest.fn(() => ({ agents: [], models: [], tools: [] })) };
    service = new ScheduleService(
      store,
      chatService as unknown as ChatService,
      configService as unknown as ClawConfigService,
      undefined,
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [ScheduleController],
      providers: [
        { provide: ScheduleService, useValue: service },
        { provide: SCHEDULE_STORE, useValue: store },
      ],
    }).compile();
    controller = moduleRef.get(ScheduleController);
  });

  it('GET 返回任务列表（含 payload 解析与最近运行）', async () => {
    const rec = store.create({
      type: 'every',
      cron: '10s',
      payload: JSON.stringify({ agentId: 'ag_1', prompt: '提醒' }),
    });
    const run = store.recordRunStart(rec.id);
    store.recordRunFinish(run.id, 'ok', '结果');

    const list = controller.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      type: 'every',
      cron: '10s',
      enabled: true,
    });
    expect(list[0].payload).toEqual({ agentId: 'ag_1', prompt: '提醒' });
    expect(list[0].lastRuns).toHaveLength(1);
  });

  it('POST 创建任务并返回 id', () => {
    const res = controller.create({
      type: 'every',
      cron: '5m',
      payload: { prompt: '汇报', agentId: 'ag_1' },
    });
    expect(res.id).toMatch(/^sch-/);
    expect(store.get(res.id)).toBeTruthy();
  });

  it('POST payload 为字符串也可创建', () => {
    const res = controller.create({
      type: 'at',
      cron: '2030-01-01T00:00:00Z',
      payload: JSON.stringify({ prompt: 'hi' }),
    });
    expect(res.id).toBeTruthy();
  });

  it('POST 非法参数返回 400', () => {
    expect(() =>
      controller.create({ type: 'every', cron: 'abc', payload: { prompt: 'x' } }),
    ).toThrow(/无效的 every 间隔/);
  });

  it('DELETE 删除任务', () => {
    const rec = store.create({
      type: 'every',
      cron: '10s',
      payload: JSON.stringify({ prompt: 'x' }),
    });
    expect(controller.remove(rec.id)).toEqual({ removed: true });
    expect(controller.remove(rec.id)).toEqual({ removed: false });
  });
});
