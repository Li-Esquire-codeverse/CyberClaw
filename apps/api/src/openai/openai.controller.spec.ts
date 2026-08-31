import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { OpenAiController } from './openai.controller';
import { ChatService, type BuiltAgent, type ChatSseEvent } from '../chat/chat.service';
import { ClawConfigService } from '../claw/claw-config.service';
import type { ClawAgent } from '../claw/claw.types';

/** 可编程的 mock Response（支持 SSE 输出 + JSON 响应两套路径） */
function mockRes(): Response & {
  chunks: string[];
  body: unknown;
  statusCode: number;
  ended: boolean;
} {
  const headers: Record<string, string> = {};
  return {
    chunks: [],
    body: undefined,
    statusCode: 200,
    ended: false,
    destroyed: false,
    writableEnded: false,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(obj: unknown) {
      this.body = obj;
      this.ended = true;
      return this;
    },
    setHeader(k: string, v: string) {
      headers[k] = v;
      return this;
    },
    flushHeaders() {
      this.headersSent = true;
      return this;
    },
    write(s: string) {
      this.chunks.push(s);
      return true;
    },
    end() {
      this.ended = true;
      this.writableEnded = true;
      return this;
    },
    on() {
      return this;
    },
  } as unknown as Response & {
    chunks: string[];
    body: unknown;
    statusCode: number;
    ended: boolean;
  };
}

const sampleAgent: ClawAgent = {
  id: 'ag_1',
  name: '测试助手',
  systemPrompt: '你是测试助手',
  modelId: 'mdl_1',
  tools: ['echo'],
  enabled: true,
  createdAt: '2026-08-09T08:39:30.948Z',
};

const sampleAgents: ClawAgent[] = [
  sampleAgent,
  { ...sampleAgent, id: 'ag_2', name: '旅游助手', enabled: false },
];

const built = { agent: sampleAgent, created: {} } as BuiltAgent;

async function* streamOf(events: ChatSseEvent[]): AsyncGenerator<ChatSseEvent> {
  for (const e of events) yield e;
}

describe('OpenAiController', () => {
  let controller: OpenAiController;
  const chatService = {
    buildAgent: jest.fn(),
    streamChat: jest.fn(),
    resolveAgentIdOrThrow: jest.fn(),
  };
  const configService = { listAgents: jest.fn(), listModels: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    chatService.buildAgent.mockResolvedValue(built);
    configService.listAgents.mockReturnValue(sampleAgents);
    const moduleRef = await Test.createTestingModule({
      controllers: [OpenAiController],
      providers: [
        { provide: ChatService, useValue: chatService },
        { provide: ClawConfigService, useValue: configService },
      ],
    }).compile();
    controller = moduleRef.get(OpenAiController);
  });

  describe('GET /v1/models', () => {
    it('列出启用的智能体（按 model 字段映射）', () => {
      expect(controller.listModels()).toEqual([
        {
          id: 'ag_1',
          object: 'model',
          created: Math.floor(new Date('2026-08-09T08:39:30.948Z').getTime() / 1000),
          owned_by: 'cyberclaw',
        },
      ]);
    });
  });

  describe('POST /v1/chat/completions（非流式）', () => {
    it('聚合 content delta 返回完整 choices（agent_start/reasoning 不污染）', async () => {
      chatService.streamChat.mockReturnValue(
        streamOf([
          { event: 'agent_start', agentId: 'ag_1', agentName: '测试助手' },
          { event: 'reasoning_delta', reasoning: '思考' },
          { choices: [{ delta: { role: 'assistant', content: '你' } }] },
          { choices: [{ delta: { role: 'assistant', content: '好' } }] },
          '[DONE]',
        ]),
      );
      const res = mockRes();
      await controller.chatCompletions(
        { model: 'agent:ag_1', messages: [{ role: 'user', content: 'hi' }], stream: false },
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.object).toBe('chat.completion');
      expect((body.choices as Array<Record<string, unknown>>)[0].message).toEqual({
        role: 'assistant',
        content: '你好',
      });
      expect(body.model).toBe('agent:ag_1');
    });

    it('聚合 tool_start/tool_end 为完整 tool_calls（arguments 拼接）', async () => {
      chatService.streamChat.mockReturnValue(
        streamOf([
          { event: 'agent_start', agentId: 'ag_1', agentName: '测试助手' },
          { event: 'tool_start', tool: 'web-search', args: '{"q' },
          { event: 'tool_end', tool: 'web-search', ok: true, args: '{"query":"机票"}' },
          { choices: [{ delta: { role: 'assistant', content: '找到' } }] },
          '[DONE]',
        ]),
      );
      const res = mockRes();
      await controller.chatCompletions(
        { model: 'agent:ag_1', messages: [{ role: 'user', content: 'hi' }] },
        res as unknown as Response,
      );
      const message = (res.body as { choices: Array<{ message: Record<string, unknown> }> })
        .choices[0].message;
      expect(message.content).toBe('找到');
      expect(message.tool_calls).toEqual([
        {
          id: 'call_0',
          type: 'function',
          function: { name: 'web-search', arguments: '{"query":"机票"}' },
        },
      ]);
    });

    it('stream 缺省（不传）视为非流式', async () => {
      chatService.streamChat.mockReturnValue(
        streamOf([
          { choices: [{ delta: { role: 'assistant', content: 'x' } }] },
          '[DONE]',
        ]),
      );
      const res = mockRes();
      await controller.chatCompletions(
        { messages: [{ role: 'user', content: 'hi' }] },
        res as unknown as Response,
      );
      expect(res.body).toBeDefined();
      expect(res.chunks.length).toBe(0);
    });
  });

  describe('POST /v1/chat/completions（流式）', () => {
    it('翻译为 OpenAI SSE 行并以 data: [DONE] 收尾', async () => {
      chatService.streamChat.mockReturnValue(
        streamOf([
          { event: 'agent_start', agentId: 'ag_1', agentName: '测试助手' },
          { event: 'reasoning_delta', reasoning: '思考' },
          { choices: [{ delta: { role: 'assistant', content: '你' } }] },
          { event: 'tool_start', tool: 'translate', args: '{"t' },
          { event: 'tool_end', tool: 'translate', ok: true, args: '{"text":"你好"}' },
          '[DONE]',
        ]),
      );
      const res = mockRes();
      await controller.chatCompletions(
        { model: 'ag_1', messages: [{ role: 'user', content: 'hi' }], stream: true },
        res as unknown as Response,
      );
      const lines = res.chunks.map((c) => c.trim());
      // agent_start / reasoning_delta 不产生行；首行 content delta 带 role
      const first = JSON.parse(lines[0].replace(/^data: /, '')) as {
        choices: Array<{ delta: { role?: string; content?: string } }>;
      };
      expect(first.choices[0].delta).toEqual({ role: 'assistant', content: '你' });
      expect(lines[1]).toContain('"tool_calls"');
      // tool_end 只发剩余增量（tool_start 已发 '{"t'）
      const toolEnd = JSON.parse(lines[2].replace(/^data: /, '')) as {
        choices: Array<{ delta: { tool_calls: Array<{ function: { arguments: string } }> } }>;
      };
      expect(toolEnd.choices[0].delta.tool_calls[0].function.arguments).toBe('ext":"你好"}');
      expect(lines[lines.length - 1]).toBe('data: [DONE]');
    });
  });

  describe('model 解析', () => {
    it('agent:<id> 前缀 → 用 id 构建', async () => {
      const res = mockRes();
      await controller.chatCompletions(
        { model: 'agent:ag_2', messages: [{ role: 'user', content: 'hi' }] },
        res as unknown as Response,
      );
      expect(chatService.buildAgent).toHaveBeenCalledWith('ag_2');
    });

    it('agent 名称 → 匹配名称', async () => {
      const res = mockRes();
      await controller.chatCompletions(
        { model: '测试助手', messages: [{ role: 'user', content: 'hi' }] },
        res as unknown as Response,
      );
      expect(chatService.buildAgent).toHaveBeenCalledWith('ag_1');
    });

    it('agent id 直接传 → 匹配 id', async () => {
      const res = mockRes();
      await controller.chatCompletions(
        { model: 'ag_1', messages: [{ role: 'user', content: 'hi' }] },
        res as unknown as Response,
      );
      expect(chatService.buildAgent).toHaveBeenCalledWith('ag_1');
    });

    it('缺省 model → 走多 agent 路由', async () => {
      chatService.resolveAgentIdOrThrow.mockReturnValue('ag_1');
      const res = mockRes();
      await controller.chatCompletions(
        { messages: [{ role: 'user', content: '推荐旅游' }] },
        res as unknown as Response,
      );
      expect(chatService.resolveAgentIdOrThrow).toHaveBeenCalledWith('推荐旅游');
      expect(chatService.buildAgent).toHaveBeenCalledWith('ag_1');
    });

    it('model 不存在 → 404 + OpenAI 风格错误', async () => {
      const res = mockRes();
      await controller.chatCompletions(
        { model: 'nope', messages: [{ role: 'user', content: 'hi' }] },
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({
        error: {
          message: '未知的模型或智能体: nope',
          type: 'invalid_request_error',
          code: '404',
        },
      });
    });
  });

  describe('错误处理', () => {
    it('缺 messages → 400', async () => {
      const res = mockRes();
      await controller.chatCompletions({} as never, res as unknown as Response);
      expect(res.statusCode).toBe(400);
      expect((res.body as { error: { type: string } }).error.type).toBe(
        'invalid_request_error',
      );
    });

    it('messages 全为 system → 400（没有可用 user/assistant 消息）', async () => {
      const res = mockRes();
      await controller.chatCompletions(
        { messages: [{ role: 'system', content: '你是助手' }] },
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(400);
    });

    it('未知 role → 400', async () => {
      const res = mockRes();
      await controller.chatCompletions(
        { messages: [{ role: 'function', content: 'x' }] },
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(400);
    });

    it('buildAgent 抛 NotFoundException → 404 OpenAI 风格', async () => {
      chatService.buildAgent.mockRejectedValue(
        new NotFoundException('智能体不存在: ag_x'),
      );
      const res = mockRes();
      await controller.chatCompletions(
        { model: 'agent:ag_x', messages: [{ role: 'user', content: 'hi' }] },
        res as unknown as Response,
      );
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({
        error: {
          message: '智能体不存在: ag_x',
          type: 'invalid_request_error',
          code: '404',
        },
      });
    });
  });
});
