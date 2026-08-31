import { Test } from '@nestjs/testing';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  ToolMessage,
} from '@langchain/core/messages';
import {
  ChatService,
  CHAT_TOOL_EXECUTORS,
  type BuiltAgent,
} from './chat.service';
import { ClawConfigService } from '../claw/claw-config.service';
import { RouterService } from '../routing/router.service';
import { CONVERSATIONS_STORE } from './conversations.store';
import { MEMORY_STORE, type MemoryStore } from '../memory/memory.store';
import { CompactStore } from '../compaction/compact.store';
import type { ClawAgent } from '../claw/claw.types';

// @cyberclaw/agent-core 为 ESM 包，ChatService 内部用动态 import 加载，
// 单测中通过 jest.mock 拦截，避免 CJS 测试环境加载 ESM。
const createLangchainAgentMock = jest.fn();
jest.mock('@cyberclaw/agent-core', () => ({
  createLangchainAgent: (...args: unknown[]) =>
    createLangchainAgentMock(...args),
}));

const sampleAgent: ClawAgent = {
  id: 'ag_1',
  name: '测试助手',
  systemPrompt: '你是测试助手',
  modelId: 'mdl_1',
  tools: ['echo'],
  enabled: true,
};

const sampleConfig = {
  agents: [sampleAgent],
  models: [
    {
      id: 'mdl_1',
      provider: 'test',
      name: '测试模型',
      model: 'test-model',
      baseUrl: 'http://localhost:9999/v1',
      apiKey: 'sk-test',
      enabled: true,
      isDefault: true,
    },
  ],
  tools: [
    { name: 'echo', label: '回显', description: '回显文本', enabled: true },
  ],
};

function builtAgentOf(agent: ClawAgent = sampleAgent): BuiltAgent {
  return {
    agent,
    created: {
      agent: {
        stream: jest.fn(),
        getState: jest.fn(async () => ({ values: { messages: [] } })),
      } as unknown as BuiltAgent['created']['agent'],
      model: sampleConfig.models[0],
      chatModel: {} as BuiltAgent['created']['chatModel'],
      tools: [],
      config: sampleConfig,
    },
  };
}

describe('ChatService', () => {
  let service: ChatService;
  const configService = { loadConfig: jest.fn() };
  const memoryStore = {
    buildPromptInjection: jest.fn(),
  } as unknown as MemoryStore;
  const conversationsStore = {
    list: jest.fn(() => []),
    upsert: jest.fn((input: unknown) => ({
      ...(input as object),
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
    })),
    remove: jest.fn(() => true),
    close: jest.fn(),
  };
  const compactStore = { loadSummary: jest.fn(), saveSummary: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.loadConfig.mockReturnValue(sampleConfig);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: ClawConfigService, useValue: configService },
        { provide: CHAT_TOOL_EXECUTORS, useValue: {} },
        { provide: CONVERSATIONS_STORE, useValue: conversationsStore },
        { provide: MEMORY_STORE, useValue: memoryStore },
        { provide: CompactStore, useValue: compactStore },
        { provide: RouterService, useValue: new RouterService() },
      ],
    }).compile();
    service = moduleRef.get(ChatService);
  });

  describe('buildAgent', () => {
    beforeEach(() => {
      memoryStore.buildPromptInjection = jest.fn().mockResolvedValue(null);
    });

    it('根据智能体配置调用 createLangchainAgent（modelId/systemPrompt/配置/记忆）', async () => {
      createLangchainAgentMock.mockResolvedValue(builtAgentOf().created);
      const result = await service.buildAgent('ag_1');
      expect(result.agent).toEqual(sampleAgent);
      const callArgs = createLangchainAgentMock.mock.calls[0][0];
      expect(callArgs).toMatchObject({
        config: sampleConfig,
        modelId: 'mdl_1',
        systemPrompt: '你是测试助手',
        toolExecutors: {},
      });
      // 对话记忆 checkpointer 已注入（默认 MemorySaver）
      expect(callArgs.checkpointer).toBeInstanceOf(MemorySaver);
    });

    it('智能体不存在时抛 404', async () => {
      await expect(service.buildAgent('ag_nope')).rejects.toThrow(
        NotFoundException,
      );
      expect(createLangchainAgentMock).not.toHaveBeenCalled();
    });

    it('智能体停用时抛 422', async () => {
      const disabled = { ...sampleAgent, enabled: false };
      configService.loadConfig.mockReturnValue({
        ...sampleConfig,
        agents: [disabled],
      });
      await expect(service.buildAgent('ag_1')).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('关联模型未启用时抛 422', async () => {
      configService.loadConfig.mockReturnValue({
        ...sampleConfig,
        models: [{ ...sampleConfig.models[0], enabled: false }],
      });
      await expect(service.buildAgent('ag_1')).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('记忆非空时拼入 systemPrompt（注入生效）', async () => {
      memoryStore.buildPromptInjection = jest
        .fn()
        .mockResolvedValue({
          header: '【长期记忆】以下是关于用户的信息：',
          body: '- 2026-08-21 用户是一名律师',
        });
      createLangchainAgentMock.mockResolvedValue(builtAgentOf().created);

      await service.buildAgent('ag_1');
      const callArgs = createLangchainAgentMock.mock.calls[0][0];
      expect(callArgs.systemPrompt).toContain('【长期记忆】');
      expect(callArgs.systemPrompt).toContain('用户是一名律师');
      // 智能体自身提示词保留
      expect(callArgs.systemPrompt).toContain('你是测试助手');
    });

    it('MEMORY_INJECT=0 时不注入记忆', async () => {
      const prev = process.env.MEMORY_INJECT;
      process.env.MEMORY_INJECT = '0';
      try {
        memoryStore.buildPromptInjection = jest
          .fn()
          .mockResolvedValue({
            header: '【长期记忆】',
            body: '不应出现',
          });
        createLangchainAgentMock.mockResolvedValue(builtAgentOf().created);

        await service.buildAgent('ag_1');
        const callArgs = createLangchainAgentMock.mock.calls[0][0];
        expect(callArgs.systemPrompt).toBe('你是测试助手');
        expect(callArgs.systemPrompt).not.toContain('【长期记忆】');
      } finally {
        if (prev === undefined) delete process.env.MEMORY_INJECT;
        else process.env.MEMORY_INJECT = prev;
      }
    });

    it('记忆为空（injection=null）时 systemPrompt 保持原样', async () => {
      memoryStore.buildPromptInjection = jest.fn().mockResolvedValue(null);
      createLangchainAgentMock.mockResolvedValue(builtAgentOf().created);

      await service.buildAgent('ag_1');
      const callArgs = createLangchainAgentMock.mock.calls[0][0];
      expect(callArgs.systemPrompt).toBe('你是测试助手');
    });
  });

  describe('streamChat', () => {
    it('按 token 输出 OpenAI 兼容 delta 事件', async () => {
      const chunks: (AIMessageChunk | ToolMessage)[] = [
        new AIMessageChunk({ content: '你' }),
        new AIMessageChunk({ content: '好' }),
      ];
      const built = builtAgentOf();
      (built.created.agent.stream as jest.Mock).mockImplementation(
        async function* () {
          for (const c of chunks) yield [c, { langgraph_node: 'model' }];
        },
      );

      const events = [];
      for await (const evt of service.streamChat(built, [
        { role: 'user', content: 'hi' },
      ])) {
        events.push(evt);
      }
      expect(events).toEqual([
        { event: 'agent_start', agentId: 'ag_1', agentName: '测试助手' },
        { choices: [{ delta: { role: 'assistant', content: '你' } }] },
        { choices: [{ delta: { role: 'assistant', content: '好' } }] },
        '[DONE]',
      ]);
    });

    it('思考过程输出 reasoning_delta 事件（增量拼接到正文之前）', async () => {
      const chunks: (AIMessageChunk | ToolMessage)[] = [
        new AIMessageChunk({
          content: '',
          additional_kwargs: { reasoning_content: '用户问的是一道算术题，' },
        }),
        new AIMessageChunk({
          content: '',
          additional_kwargs: { reasoning_content: '我需要计算 1+2' },
        }),
        new AIMessageChunk({ content: '结果是 3' }),
      ];
      const built = builtAgentOf();
      (built.created.agent.stream as jest.Mock).mockImplementation(
        async function* () {
          for (const c of chunks) yield [c, { langgraph_node: 'model' }];
        },
      );

      const events = [];
      for await (const evt of service.streamChat(built, [
        { role: 'user', content: '1+2 等于几？' },
      ])) {
        events.push(evt);
      }
      expect(events).toEqual([
        { event: 'agent_start', agentId: 'ag_1', agentName: '测试助手' },
        { event: 'reasoning_delta', reasoning: '用户问的是一道算术题，' },
        { event: 'reasoning_delta', reasoning: '我需要计算 1+2' },
        { choices: [{ delta: { role: 'assistant', content: '结果是 3' } }] },
        '[DONE]',
      ]);
    });

    it('工具调用输出 tool_start / tool_end 事件', async () => {
      const toolChunk = new AIMessageChunk({
        content: '',
        tool_call_chunks: [
          { name: 'echo', args: '{"text":"hi"}', id: 'call_1', index: 0 },
        ],
      });
      const toolResult = new ToolMessage({
        content: 'echo:hi',
        name: 'echo',
        tool_call_id: 'call_1',
      });
      const finalChunk = new AIMessageChunk({ content: '完成' });
      const built = builtAgentOf();
      (built.created.agent.stream as jest.Mock).mockImplementation(
        async function* () {
          yield [toolChunk, { langgraph_node: 'model' }];
          yield [toolResult, { langgraph_node: 'tools' }];
          yield [finalChunk, { langgraph_node: 'model' }];
        },
      );

      const events = [];
      for await (const evt of service.streamChat(built, [
        { role: 'user', content: 'hi' },
      ])) {
        events.push(evt);
      }
      expect(events[1]).toEqual({
        event: 'tool_start',
        tool: 'echo',
        args: '{"text":"hi"}',
      });
      expect(events[2]).toEqual({
        event: 'tool_end',
        tool: 'echo',
        ok: true,
        args: '{"text":"hi"}',
        result: 'echo:hi',
      });
      expect(events[3]).toEqual({
        choices: [{ delta: { role: 'assistant', content: '完成' } }],
      });
      expect(events[4]).toBe('[DONE]');
    });

    it('未实现的工具结果标记为 ok:false', async () => {
      const toolResult = new ToolMessage({
        content:
          '[工具未实现] 工具 "echo" 的执行器尚未注册，请通过 toolExecutors 注入',
        name: 'echo',
        tool_call_id: 'call_1',
      });
      const built = builtAgentOf();
      (built.created.agent.stream as jest.Mock).mockImplementation(
        async function* () {
          yield [toolResult, { langgraph_node: 'tools' }];
        },
      );

      const events = [];
      for await (const evt of service.streamChat(built, [
        { role: 'user', content: 'hi' },
      ])) {
        events.push(evt);
      }
      expect(events[1]).toMatchObject({ event: 'tool_end', ok: false });
    });

    it('system/human 等非 AI/Tool 消息不产生事件，仅以 [DONE] 收尾', async () => {
      const built = builtAgentOf();
      (built.created.agent.stream as jest.Mock).mockImplementation(
        async function* () {
          yield [new HumanMessage('历史消息'), { langgraph_node: 'model' }];
        },
      );

      const events = [];
      for await (const evt of service.streamChat(built, [
        { role: 'user', content: 'hi' },
      ])) {
        events.push(evt);
      }
      expect(events).toEqual([
        { event: 'agent_start', agentId: 'ag_1', agentName: '测试助手' },
        '[DONE]',
      ]);
    });

    it('conversationId 映射为 langgraph thread_id（对话记忆）', async () => {
      const built = builtAgentOf();
      const streamMock = jest.fn().mockImplementation(async function* () {
        // no-op
      });
      (built.created.agent.stream as jest.Mock).mockImplementation(streamMock);

      for await (const _evt of service.streamChat(
        built,
        [{ role: 'user', content: 'hi' }],
        undefined,
        'conv-1',
      )) {
        /* collect */
      }

      const [, config] = streamMock.mock.calls[0];
      expect(config.configurable?.thread_id).toBe('conv-1');
    });

    it('缺省 conversationId 时按智能体 ID 兜底隔离', async () => {
      const built = builtAgentOf();
      const streamMock = jest.fn().mockImplementation(async function* () {
        // no-op
      });
      (built.created.agent.stream as jest.Mock).mockImplementation(streamMock);

      for await (const _evt of service.streamChat(built, [
        { role: 'user', content: 'hi' },
      ])) {
        /* collect */
      }

      const [, config] = streamMock.mock.calls[0];
      expect(config.configurable?.thread_id).toBe('agent:ag_1');
    });

    it('消息历史转换为 langchain BaseMessage 后传给 agent.stream', async () => {
      const built = builtAgentOf();
      const streamMock = jest.fn().mockImplementation(async function* () {
        // no-op
      });
      (built.created.agent.stream as jest.Mock).mockImplementation(streamMock);

      for await (const _evt of service.streamChat(built, [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '在的' },
        { role: 'user', content: '再问' },
      ])) {
        /* collect */
      }

      const [state, config] = streamMock.mock.calls[0];
      const roles = state.messages.map((m: unknown) =>
        m instanceof HumanMessage
          ? 'user'
          : m instanceof AIMessage
            ? 'assistant'
            : '?',
      );
      expect(roles).toEqual(['user', 'assistant', 'user']);
      expect(config).toMatchObject({ streamMode: 'messages' });
    });
  });

  describe('压缩预处理（Phase 4 C2）', () => {
    /** 线程历史：31 条 user/assistant 交替消息（超过 30 阈值） */
    function longThreadMessages(): Array<HumanMessage | AIMessage> {
      return Array.from({ length: 31 }, (_, i) =>
        i % 2 === 0
          ? new HumanMessage(`问题 ${i}`)
          : new AIMessage(`回答 ${i}`),
      );
    }

    beforeEach(() => {
      compactStore.loadSummary.mockReturnValue(undefined);
      compactStore.saveSummary.mockClear();
    });

    it('未超阈值：不重建 agent、不写摘要、不注入摘要文本', async () => {
      const built = builtAgentOf();
      (built.created.agent.stream as jest.Mock).mockImplementation(
        async function* () {
          yield [new AIMessageChunk({ content: 'hi' }), { langgraph_node: 'model' }];
        },
      );

      const events = [];
      for await (const evt of service.streamChat(
        built,
        [{ role: 'user', content: 'hi' }],
        undefined,
        'conv-1',
      )) {
        events.push(evt);
      }

      // 测试直接传 built（不经 buildAgent）：无重建 → createLangchainAgentMock 零调用
      expect(createLangchainAgentMock).not.toHaveBeenCalled();
      expect(compactStore.saveSummary).not.toHaveBeenCalled();
      expect(events[events.length - 1]).toBe('[DONE]');
    });

    it('超阈值且无摘要：重建带摘要的 agent 并写入库', async () => {
      const built = builtAgentOf();
      (built.created.agent.stream as jest.Mock).mockImplementation(
        async function* () {
          yield [new AIMessageChunk({ content: 'ok' }), { langgraph_node: 'model' }];
        },
      );
      // 线程历史超阈值
      (built.created.agent.getState as unknown as jest.Mock).mockResolvedValue({
        values: { messages: longThreadMessages() },
      });
      // 带摘要重建后返回的 agent（其 stream 即最终回复流）
      const rebuilt = builtAgentOf();
      (rebuilt.created.agent.stream as jest.Mock).mockImplementation(
        async function* () {
          yield [new AIMessageChunk({ content: '最终回复' }), { langgraph_node: 'model' }];
        },
      );
      createLangchainAgentMock.mockResolvedValue(rebuilt.created);

      const events = [];
      for await (const evt of service.streamChat(
        built,
        [{ role: 'user', content: 'hi' }],
        undefined,
        'conv-1',
      )) {
        events.push(evt);
      }

      // 摘要生成路径复用传入 agent（不重建），仅注入重建 1 次
      expect(createLangchainAgentMock).toHaveBeenCalledTimes(1);
      // 摘要（来自摘要流 'ok'）已写入库
      expect(compactStore.saveSummary).toHaveBeenCalledWith(
        'conv-1',
        expect.stringContaining('ok'),
      );
      // 重建的 agent systemPrompt 注入摘要 + 最近 10 条上下文
      const lastCall = createLangchainAgentMock.mock.calls[0][0];
      expect(lastCall.systemPrompt).toContain('【历史对话摘要】');
      expect(lastCall.systemPrompt).toContain('【近期对话上下文】');
      expect(lastCall.systemPrompt).toContain('问题 30'); // 最近 10 条（31 条的末尾）
      expect(lastCall.systemPrompt).not.toContain('问题 0'); // 更早的历史不进上下文
      expect(events[events.length - 1]).toBe('[DONE]');
    });

    it('超阈值且库中已有摘要（≤60 条）：复用不重算', async () => {
      const built = builtAgentOf();
      (built.created.agent.stream as jest.Mock).mockImplementation(
        async function* () {
          yield [new AIMessageChunk({ content: 'ok' }), { langgraph_node: 'model' }];
        },
      );
      (built.created.agent.getState as unknown as jest.Mock).mockResolvedValue({
        values: { messages: longThreadMessages() },
      });
      compactStore.loadSummary.mockReturnValue('旧摘要');
      const rebuilt = builtAgentOf();
      (rebuilt.created.agent.stream as jest.Mock).mockImplementation(
        async function* () {
          yield [new AIMessageChunk({ content: 'ok' }), { langgraph_node: 'model' }];
        },
      );
      createLangchainAgentMock.mockResolvedValue(rebuilt.created);

      for await (const _evt of service.streamChat(
        built,
        [{ role: 'user', content: 'hi' }],
        undefined,
        'conv-1',
      )) {
        /* collect */
      }

      // 只重建一次（带旧摘要），不触发摘要生成、不写库
      expect(createLangchainAgentMock).toHaveBeenCalledTimes(1);
      expect(compactStore.saveSummary).not.toHaveBeenCalled();
      const lastCall = createLangchainAgentMock.mock.calls[0][0];
      expect(lastCall.systemPrompt).toContain('旧摘要');
    });
  });

  describe('conversations', () => {
    it('getHistory 从线程快照恢复 user/assistant 消息（含思考内容）', async () => {
      const built = builtAgentOf();
      const getState = jest.fn().mockResolvedValue({
        values: {
          messages: [
            new HumanMessage('你好，我叫小明'),
            new AIMessage({
              content: '记住了',
              additional_kwargs: { reasoning_content: '用户报了名字，记下' },
            }),
            new ToolMessage({ content: 'ok', tool_call_id: 'c1', name: 't' }),
            new HumanMessage('我叫什么？'),
          ],
        },
      });
      (built.created.agent as unknown as { getState: unknown }).getState = getState;
      // buildAgent 内部会调用 createLangchainAgent，需返回同一个带 getState 的实例
      createLangchainAgentMock.mockResolvedValue(built.created);

      const history = await service.getHistory('ag_1', 'conv-1');

      expect(getState).toHaveBeenCalledWith({
        configurable: { thread_id: 'conv-1' },
      });
      expect(history).toEqual([
        { role: 'user', content: '你好，我叫小明' },
        {
          role: 'assistant',
          content: '记住了',
          thinkContent: '用户报了名字，记下',
        },
        { role: 'user', content: '我叫什么？' },
      ]);
    });

    it('listConversations 透传给 store', async () => {
      const rows = [{ id: 'c1' }];
      (conversationsStore.list as jest.Mock).mockReturnValue(rows);
      expect(service.listConversations('ag_1')).toBe(rows);
      expect(conversationsStore.list).toHaveBeenCalledWith('ag_1');
    });

    it('upsertConversation 透传给 store', () => {
      const result = service.upsertConversation({
        id: 'c1',
        agentId: 'ag_1',
        title: '新对话',
      });
      expect(conversationsStore.upsert).toHaveBeenCalledWith({
        id: 'c1',
        agentId: 'ag_1',
        title: '新对话',
      });
      expect(result).toMatchObject({ id: 'c1' });
    });

    it('removeConversation 删除列表记录（MemorySaver 无 deleteThread 联动）', () => {
      expect(service.removeConversation('c1')).toBe(true);
      expect(conversationsStore.remove).toHaveBeenCalledWith('c1');
    });
  });

  describe('resolveAgentIdOrThrow（多 agent 路由，Phase 4 A3）', () => {
    it('按消息关键词命中对应 agent', () => {
      configService.loadConfig.mockReturnValue({
        agents: [
          { ...sampleAgent, id: 'ag_law', name: '法律文书', keywords: ['合同', '律师'] },
          sampleAgent,
        ],
        models: sampleConfig.models,
        tools: sampleConfig.tools,
      });
      expect(service.resolveAgentIdOrThrow('帮我写份合同')).toBe('ag_law');
    });

    it('无关键词命中时回退第一个启用 agent', () => {
      configService.loadConfig.mockReturnValue({
        agents: [
          { ...sampleAgent, id: 'ag_law', name: '法律文书', keywords: ['合同'] },
          sampleAgent,
        ],
        models: sampleConfig.models,
        tools: sampleConfig.tools,
      });
      expect(service.resolveAgentIdOrThrow('今天天气怎么样')).toBe('ag_law');
    });

    it('全部停用时抛 422', () => {
      configService.loadConfig.mockReturnValue({
        agents: [{ ...sampleAgent, enabled: false }],
        models: sampleConfig.models,
        tools: sampleConfig.tools,
      });
      expect(() => service.resolveAgentIdOrThrow('你好')).toThrow(
        UnprocessableEntityException,
      );
    });
  });
});
