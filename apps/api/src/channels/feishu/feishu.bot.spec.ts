import { Test } from '@nestjs/testing';
import { ChatService } from '../../chat/chat.service';
import { ClawConfigService } from '../../claw/claw-config.service';
import {
  FEISHU_CLIENT,
  FEISHU_SESSIONS,
  FeishuBotService,
} from './feishu.bot';
import type { FeishuClientPort, FeishuIncomingMessage } from './feishu.lark-client';
import type { FeishuSessionStore } from './feishu.sessions';
import type { ChatSseEvent } from '../../chat/chat.service';

describe('FeishuBotService', () => {
  let service: FeishuBotService;
  let client: jest.Mocked<FeishuClientPort>;
  let chatService: {
    buildAgent: jest.Mock;
    streamChat: jest.Mock;
  };
  const sessions: FeishuSessionStore & {
    getOrCreate: jest.Mock;
    switchAgent: jest.Mock;
  } = {
    get: jest.fn(),
    upsert: jest.fn(),
    getOrCreate: jest.fn(() => 'conv-abc'),
    switchAgent: jest.fn(() => 'conv-new'),
  };
  const configService = { loadConfig: jest.fn() };

  const sentTexts: { chatId: string; text: string }[] = [];

  const realEnv = { ...process.env };

  beforeEach(async () => {
    jest.clearAllMocks();
    sentTexts.length = 0;
    client = {
      start: jest.fn(async (_onMessage: (m: FeishuIncomingMessage) => void | Promise<void>) => undefined),
      stop: jest.fn(async () => undefined),
      sendText: jest.fn(async (chatId: string, text: string) => {
        sentTexts.push({ chatId, text });
      }),
    } as unknown as jest.Mocked<FeishuClientPort>;

    chatService = {
      buildAgent: jest.fn(),
      streamChat: jest.fn(),
    };
    configService.loadConfig.mockReturnValue({
      agents: [{ id: 'ag_1', name: '测试助手', enabled: true }],
      models: [],
      tools: [],
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        FeishuBotService,
        { provide: ChatService, useValue: chatService },
        { provide: ClawConfigService, useValue: configService },
        { provide: FEISHU_CLIENT, useValue: client },
        { provide: FEISHU_SESSIONS, useValue: sessions },
      ],
    }).compile();
    service = moduleRef.get(FeishuBotService);
  });

  afterEach(() => {
    process.env = { ...realEnv };
  });

  it('client 为 null 时不启动（优雅降级）', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        FeishuBotService,
        { provide: ChatService, useValue: chatService },
        { provide: ClawConfigService, useValue: configService },
        { provide: FEISHU_CLIENT, useValue: null },
        { provide: FEISHU_SESSIONS, useValue: sessions },
      ],
    }).compile();
    const svc = moduleRef.get(FeishuBotService);
    await svc.onModuleInit();
    expect(client.start).not.toHaveBeenCalled();
  });

  it('onModuleInit 启动长连接并注册消息回调', async () => {
    await service.onModuleInit();
    expect(client.start).toHaveBeenCalledWith(expect.any(Function));
    // 回调转发到 handleMessage：调用回调应触发消息处理
    const cb = client.start.mock.calls[0][0] as (m: FeishuIncomingMessage) => Promise<void>;
    await cb({
      chatId: 'c1',
      chatType: 'p2p',
      messageType: 'text',
      text: 'hi',
      senderOpenId: 'u1',
      mentionBot: false,
    });
    expect(chatService.buildAgent).toHaveBeenCalled();
  });

  it('非 text 消息被忽略', async () => {
    await service.handleMessage({
      chatId: 'c1',
      chatType: 'p2p',
      messageType: 'image',
      text: '',
      senderOpenId: 'u1',
      mentionBot: false,
    });
    expect(chatService.buildAgent).not.toHaveBeenCalled();
    expect(sentTexts).toEqual([]);
  });

  it('群聊未 @机器人 时忽略', async () => {
    await service.handleMessage({
      chatId: 'c1',
      chatType: 'group',
      messageType: 'text',
      text: '随便聊聊',
      senderOpenId: 'u1',
      mentionBot: false,
    });
    expect(chatService.buildAgent).not.toHaveBeenCalled();
  });

  it('群聊 @机器人 时响应', async () => {
    const built = { created: {}, agent: { id: 'ag_1', name: '测试' } };
    chatService.buildAgent.mockResolvedValue(built);
    chatService.streamChat.mockImplementation(
      async function* (): AsyncGenerator<ChatSseEvent> {
        yield { event: 'agent_start', agentId: 'ag_1', agentName: '测试' };
        yield { choices: [{ delta: { role: 'assistant', content: '你好' } }] };
        yield '[DONE]';
      },
    );

    await service.handleMessage({
      chatId: 'c1',
      chatType: 'group',
      messageType: 'text',
      text: '你好',
      senderOpenId: 'u1',
      mentionBot: true,
    });
    expect(sentTexts).toContainEqual({ chatId: 'c1', text: '你好' });
  });

  it('完整链路：消息 → buildAgent → streamChat → 正文回复', async () => {
    const built = { created: {}, agent: { id: 'ag_1', name: '测试' } };
    chatService.buildAgent.mockResolvedValue(built);
    chatService.streamChat.mockImplementation(
      async function* (): AsyncGenerator<ChatSseEvent> {
        yield { event: 'agent_start', agentId: 'ag_1', agentName: '测试' };
        yield { event: 'tool_start', tool: 'web-search' };
        yield { event: 'tool_end', tool: 'web-search', ok: true };
        yield { choices: [{ delta: { role: 'assistant', content: '搜索到结果' } }] };
        yield '[DONE]';
      },
    );

    await service.handleMessage({
      chatId: 'c1',
      chatType: 'p2p',
      messageType: 'text',
      text: '帮我搜一下',
      senderOpenId: 'u1',
      mentionBot: false,
    });

    expect(chatService.buildAgent).toHaveBeenCalledWith('ag_1');
    expect(chatService.streamChat).toHaveBeenCalledWith(
      built,
      [{ role: 'user', content: '帮我搜一下' }],
      undefined,
      'conv-abc',
    );
    // 工具状态提示 + 最终正文
    expect(sentTexts).toContainEqual({
      chatId: 'c1',
      text: expect.stringContaining('web-search 执行中'),
    });
    expect(sentTexts).toContainEqual({
      chatId: 'c1',
      text: expect.stringContaining('web-search ✅ 完成'),
    });
    expect(sentTexts).toContainEqual({ chatId: 'c1', text: '搜索到结果' });
  });

  it('FEISHU_ALLOWED_USERS 白名单外忽略', async () => {
    process.env.FEISHU_ALLOWED_USERS = 'u_allowed';
    await service.handleMessage({
      chatId: 'c1',
      chatType: 'p2p',
      messageType: 'text',
      text: 'hi',
      senderOpenId: 'u_blocked',
      mentionBot: false,
    });
    expect(chatService.buildAgent).not.toHaveBeenCalled();
    delete process.env.FEISHU_ALLOWED_USERS;
  });

  it('buildAgent 失败时发送错误提示（不抛异常）', async () => {
    chatService.buildAgent.mockRejectedValue(
      Object.assign(new Error('智能体「测试」关联的大模型未启用'), {
        status: 422,
      }),
    );
    await service.handleMessage({
      chatId: 'c1',
      chatType: 'p2p',
      messageType: 'text',
      text: 'hi',
      senderOpenId: 'u1',
      mentionBot: false,
    });
    expect(sentTexts.some((s) => s.text.includes('出错了'))).toBe(true);
  });

  it('无可用智能体时提示', async () => {
    configService.loadConfig.mockReturnValue({
      agents: [{ id: 'ag_x', enabled: false }],
      models: [],
      tools: [],
    });
    await service.handleMessage({
      chatId: 'c1',
      chatType: 'p2p',
      messageType: 'text',
      text: 'hi',
      senderOpenId: 'u1',
      mentionBot: false,
    });
    expect(sentTexts.some((s) => s.text.includes('没有可用的智能体'))).toBe(true);
  });

  it('FEISHU_AGENT_ID 优先于默认 agent', async () => {
    process.env.FEISHU_AGENT_ID = 'ag_env';
    const built = { created: {}, agent: { id: 'ag_env', name: 'x' } };
    chatService.buildAgent.mockResolvedValue(built);
    chatService.streamChat.mockImplementation(
      async function* (): AsyncGenerator<ChatSseEvent> {
        yield { choices: [{ delta: { role: 'assistant', content: 'ok' } }] };
        yield '[DONE]';
      },
    );
    await service.handleMessage({
      chatId: 'c1',
      chatType: 'p2p',
      messageType: 'text',
      text: 'hi',
      senderOpenId: 'u1',
      mentionBot: false,
    });
    expect(chatService.buildAgent).toHaveBeenCalledWith('ag_env');
    delete process.env.FEISHU_AGENT_ID;
  });

  it('/agent 列出可用智能体（不进入对话）', async () => {
    await service.handleMessage({
      chatId: 'c1',
      chatType: 'p2p',
      messageType: 'text',
      text: '/agent',
      senderOpenId: 'u1',
      mentionBot: false,
    });
    expect(chatService.buildAgent).not.toHaveBeenCalled();
    expect(sessions.switchAgent).not.toHaveBeenCalled();
    expect(sentTexts.some((s) => s.text.includes('可用智能体'))).toBe(true);
    expect(sentTexts.some((s) => s.text.includes('测试助手'))).toBe(true);
  });

  it('/agent <名称> 切换智能体并新建会话', async () => {
    await service.handleMessage({
      chatId: 'c1',
      chatType: 'p2p',
      messageType: 'text',
      text: '/agent 测试助手',
      senderOpenId: 'u1',
      mentionBot: false,
    });
    expect(sessions.switchAgent).toHaveBeenCalledWith('c1', 'ag_1');
    expect(chatService.buildAgent).not.toHaveBeenCalled();
    expect(sentTexts.some((s) => s.text.includes('已切换到智能体'))).toBe(true);
  });

  it('/agent <名称包含> 模糊匹配', async () => {
    configService.loadConfig.mockReturnValue({
      agents: [
        { id: 'ag_1', name: '法律文书智能体', enabled: true },
        { id: 'ag_2', name: '代码助手', enabled: true },
      ],
      models: [],
      tools: [],
    });
    await service.handleMessage({
      chatId: 'c1',
      chatType: 'p2p',
      messageType: 'text',
      text: '/agent 法律',
      senderOpenId: 'u1',
      mentionBot: false,
    });
    expect(sessions.switchAgent).toHaveBeenCalledWith('c1', 'ag_1');
  });

  it('/agent <不存在的名称> 提示未找到', async () => {
    await service.handleMessage({
      chatId: 'c1',
      chatType: 'p2p',
      messageType: 'text',
      text: '/agent 不存在的助手',
      senderOpenId: 'u1',
      mentionBot: false,
    });
    expect(sessions.switchAgent).not.toHaveBeenCalled();
    expect(chatService.buildAgent).not.toHaveBeenCalled();
    expect(sentTexts.some((s) => s.text.includes('未找到智能体'))).toBe(true);
  });

  it('超长回复按 4000 字符分段发送', async () => {
    const long = 'x'.repeat(12_000);
    const built = { created: {}, agent: { id: 'ag_1', name: '测试' } };
    chatService.buildAgent.mockResolvedValue(built);
    chatService.streamChat.mockImplementation(
      async function* (): AsyncGenerator<ChatSseEvent> {
        yield { choices: [{ delta: { role: 'assistant', content: long } }] };
        yield '[DONE]';
      },
    );
    await service.handleMessage({
      chatId: 'c1',
      chatType: 'p2p',
      messageType: 'text',
      text: '来个长篇',
      senderOpenId: 'u1',
      mentionBot: false,
    });
    // 3 段：各段前缀 （1/3）（2/3）（3/3），总字符 = 12000 + 前缀
    const textMsgs = sentTexts.map((s) => s.text);
    expect(textMsgs.filter((t) => /^（\d\/3）/u.test(t)).length).toBe(3);
    const joined = textMsgs.join('');
    expect(joined.replace(/（\d\/3）\n/gu, '').length).toBe(12_000);
  });

  it('短回复不分段（无前缀）', async () => {
    const built = { created: {}, agent: { id: 'ag_1', name: '测试' } };
    chatService.buildAgent.mockResolvedValue(built);
    chatService.streamChat.mockImplementation(
      async function* (): AsyncGenerator<ChatSseEvent> {
        yield { choices: [{ delta: { role: 'assistant', content: '简短回复' } }] };
        yield '[DONE]';
      },
    );
    await service.handleMessage({
      chatId: 'c1',
      chatType: 'p2p',
      messageType: 'text',
      text: 'hi',
      senderOpenId: 'u1',
      mentionBot: false,
    });
    expect(sentTexts).toContainEqual({ chatId: 'c1', text: '简短回复' });
  });

  it('onModuleDestroy 停止长连接', async () => {
    await service.onModuleInit();
    await service.onModuleDestroy();
    expect(client.stop).toHaveBeenCalled();
  });

  it('未启动时 onModuleDestroy 不停止', async () => {
    const svc = new FeishuBotService(
      chatService as unknown as ChatService,
      configService as unknown as ClawConfigService,
      client,
      sessions,
    );
    await svc.onModuleDestroy();
    expect(client.stop).not.toHaveBeenCalled();
  });
});

// 保留类型引用避免未使用告警
export type _FeishuIncoming = FeishuIncomingMessage;
