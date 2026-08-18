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

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.loadConfig.mockReturnValue(sampleConfig);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: ClawConfigService, useValue: configService },
        { provide: CHAT_TOOL_EXECUTORS, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(ChatService);
  });

  describe('buildAgent', () => {
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
});
