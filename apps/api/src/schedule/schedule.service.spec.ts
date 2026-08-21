import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScheduleStore, type SchedulePayload } from './schedule.store';
import { ScheduleService } from './schedule.service';
import { ChatService } from '../chat/chat.service';
import { ClawConfigService } from '../claw/claw-config.service';
import { FeishuBotService } from '../channels/feishu/feishu.bot';
import type { ChatSseEvent } from '../chat/chat.service';

describe('ScheduleService', () => {
  let store: ScheduleStore;
  let service: ScheduleService;
  let chatService: { buildAgent: jest.Mock; streamChat: jest.Mock };
  let feishuBot: { sendTextToChat: jest.Mock };
  const configService = { loadConfig: jest.fn() };

  const payloadOf = (overrides: Partial<SchedulePayload> = {}): string =>
    JSON.stringify({
      agentId: 'ag_1',
      prompt: '提醒用户喝水',
      ...overrides,
    });

  const built = { created: {}, agent: { id: 'ag_1', name: '测试' } };

  beforeEach(() => {
    jest.useFakeTimers();
    store = new ScheduleStore(
      join(mkdtempSync(join(tmpdir(), 'cyberclaw-svc-')), 'test.db'),
    );
    chatService = {
      buildAgent: jest.fn(),
      streamChat: jest.fn(),
    };
    feishuBot = { sendTextToChat: jest.fn(async () => undefined) };
    configService.loadConfig.mockReturnValue({
      agents: [{ id: 'ag_1', name: '测试', enabled: true }],
      models: [],
      tools: [],
    });
    service = new ScheduleService(
      store,
      chatService as unknown as ChatService,
      configService as unknown as ClawConfigService,
      feishuBot as unknown as FeishuBotService,
    );
    chatService.buildAgent.mockResolvedValue(built);
    chatService.streamChat.mockImplementation(
      async function* (): AsyncGenerator<ChatSseEvent> {
        yield { event: 'agent_start', agentId: 'ag_1', agentName: '测试' };
        yield { choices: [{ delta: { role: 'assistant', content: '该喝水了' } }] };
        yield '[DONE]';
      },
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('runAgentTurn 消费事件返回最终文本（记忆/工具链路复用）', async () => {
    const text = await service.runAgentTurn({
      agentId: 'ag_1',
      prompt: '提醒',
    });
    expect(text).toBe('该喝水了');
    expect(chatService.buildAgent).toHaveBeenCalledWith('ag_1');
    expect(chatService.streamChat).toHaveBeenCalledWith(
      built,
      [{ role: 'user', content: '提醒' }],
      undefined,
      'schedule:ag_1',
    );
  });

  it('runAgentTurn 无 agentId 时用默认启用 agent', async () => {
    await service.runAgentTurn({ prompt: 'x' });
    expect(chatService.buildAgent).toHaveBeenCalledWith('ag_1');
  });

  it('runAgentTurn 无可用 agent 报错', async () => {
    configService.loadConfig.mockReturnValue({
      agents: [{ id: 'ag_x', enabled: false }],
      models: [],
      tools: [],
    });
    await expect(service.runAgentTurn({ prompt: 'x' })).rejects.toThrow(
      '没有可用的智能体',
    );
  });

  it('runAgentTurn pushTo feishu 时推送结果', async () => {
    await service.runAgentTurn({
      agentId: 'ag_1',
      prompt: '提醒',
      pushTo: 'feishu',
      chatId: 'oc_xxx',
    });
    expect(feishuBot.sendTextToChat).toHaveBeenCalledWith('oc_xxx', '该喝水了');
  });

  it('execute 记录运行历史（ok）', async () => {
    const rec = store.create({ type: 'every', cron: '10s', payload: payloadOf() });
    const run = await service.execute(rec);
    expect(run.status).toBe('ok');
    expect(run.output).toBe('该喝水了');
    expect(store.listRuns(rec.id)).toHaveLength(1);
  });

  it('execute 失败记录 error', async () => {
    const rec = store.create({ type: 'every', cron: '10s', payload: payloadOf() });
    chatService.buildAgent.mockRejectedValue(new Error('模型 401'));
    const run = await service.execute(rec);
    expect(run.status).toBe('error');
    expect(run.output).toContain('模型 401');
  });

  it('every 任务按间隔执行（fake timers）', async () => {
    const rec = service.createTask({
      type: 'every',
      cron: '10s',
      payload: payloadOf(),
    });
    await jest.advanceTimersByTimeAsync(10_000);
    await jest.advanceTimersByTimeAsync(10_000);
    // 两次执行 → 两条运行记录
    expect(store.listRuns(rec.id)).toHaveLength(2);
  });

  it('at 任务到点执行一次并自动删除', async () => {
    const at = new Date(Date.now() + 60_000).toISOString();
    const rec = service.createTask({ type: 'at', cron: at, payload: payloadOf() });
    expect(store.get(rec.id)).toBeTruthy();
    await jest.advanceTimersByTimeAsync(60_000);
    // 执行一次后删除
    expect(store.listRuns(rec.id)).toHaveLength(1);
    expect(store.get(rec.id)).toBeUndefined();
  });

  it('onModuleInit 注册已启用的任务', async () => {
    // 模拟重启场景：store 里已有持久化任务（不经 service 注册）
    store.create({ type: 'every', cron: '10s', payload: payloadOf() });
    // 重新实例化 → onModuleInit 从 store 加载并注册
    const service2 = new ScheduleService(
      store,
      chatService as unknown as ChatService,
      configService as unknown as ClawConfigService,
      feishuBot as unknown as FeishuBotService,
    );
    service2.onModuleInit();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(store.listRuns()).toHaveLength(1);
  });

  it('removeTask 停用定时器并删除', async () => {
    const rec = service.createTask({ type: 'every', cron: '10s', payload: payloadOf() });
    expect(service.removeTask(rec.id)).toBe(true);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(store.listRuns(rec.id)).toHaveLength(0);
  });

  it('onModuleDestroy 清理定时器', async () => {
    service.createTask({ type: 'every', cron: '10s', payload: payloadOf() });
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(store.listRuns()).toHaveLength(0);
  });

  it('已过期的 at 任务不注册（不执行）', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const rec = store.create({ type: 'at', cron: past, payload: payloadOf() });
    service.register(rec);
    await jest.advanceTimersByTimeAsync(1000);
    expect(store.listRuns(rec.id)).toHaveLength(0);
  });
});
