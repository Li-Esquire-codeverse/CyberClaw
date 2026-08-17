import { describe, expect, it, vi } from 'vitest';
import { Agent } from './agent.js';
import type { LLMClient } from './llm.js';
import { ToolRegistry } from './registry.js';
import type { Tool } from './tool.js';
import type { ChatMessage, ToolResult } from './types.js';

/** 可编程 mock LLM：按调用顺序返回预设响应 */
function createMockLLM(responses: (messages: ChatMessage[]) => ChatMessage[]) {
  const chat = vi.fn(async (messages: ChatMessage[]) => {
    if (responses.length === 0) {
      throw new Error('mock LLM: no more responses');
    }
    const next = responses.shift()!;
    return next(messages);
  });
  return { client: { chat } as LLMClient, chat };
}

const calculator: Tool = {
  name: 'calculator',
  description: '四则运算',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string' },
    },
    required: ['expression'],
  },
  execute: async (args: { expression?: string }) => {
    // 只处理加减法，便于断言
    const m = /^(\d+)\s*\+\s*(\d+)$/.exec(args.expression ?? '');
    if (!m) return { ok: false, output: 'unsupported expression' };
    const sum = Number(m[1]) + Number(m[2]);
    return { ok: true, output: String(sum) };
  },
};

describe('Agent 最小可运行循环', () => {
  it('无工具：直接返回 LLM 的最终回复', async () => {
    const { client, chat } = createMockLLM([
      () => ({ role: 'assistant', content: '你好，我是智能体' }),
    ]);
    const agent = new Agent({
      id: 'ag_1',
      name: '测试助手',
      systemPrompt: '你是测试助手',
      llm: client,
    });

    const result = await agent.run('你好');

    expect(result.text).toBe('你好，我是智能体');
    expect(result.iterations).toBe(1);
    expect(result.toolCalls).toHaveLength(0);
    expect(chat).toHaveBeenCalledTimes(1);
    // 消息历史：system + user + assistant
    expect(result.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(result.messages[0]!.content).toContain('你是测试助手');
    // 无工具时不应下发 tools 声明
    expect(chat.mock.calls[0]![1]?.tools).toBeUndefined();
  });

  it('工具循环：LLM 调 calculator，结果回填后得到最终回复', async () => {
    const { client, chat } = createMockLLM([
      (messages) => {
        // 首轮：携带 tools 声明，且返回工具调用
        expect(messages).toHaveLength(2); // system + user
        return {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              name: 'calculator',
              arguments: { expression: '1 + 2' },
            },
          ],
        };
      },
      (messages) => {
        // 次轮：应看到 tool 结果回填
        const toolMsg = messages.find((m) => m.role === 'tool');
        expect(toolMsg?.toolCallId).toBe('call_1');
        expect(toolMsg?.content).toBe('3');
        return { role: 'assistant', content: '结果是 3' };
      },
    ]);
    const agent = new Agent({
      id: 'ag_2',
      systemPrompt: '你会用计算器',
      llm: client,
      tools: [calculator],
    });

    const result = await agent.run('1+2 等于几？');

    expect(result.text).toBe('结果是 3');
    expect(result.iterations).toBe(2);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.call.name).toBe('calculator');
    expect(result.toolCalls[0]!.result.ok).toBe(true);
    // 首轮请求应携带 tools 声明
    expect(chat.mock.calls[0]![1]?.tools?.[0]).toMatchObject({
      type: 'function',
      function: { name: 'calculator' },
    });
    // 历史中 system/user/assistant/tool/assistant 顺序完整
    expect(result.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
  });

  it('未知工具：错误回填给 LLM 且不中断循环', async () => {
    const { client } = createMockLLM([
      () => ({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'no-such-tool', arguments: {} }],
      }),
      (messages) => {
        const toolMsg = messages.find((m) => m.role === 'tool');
        expect(toolMsg?.content).toContain('no-such-tool');
        return { role: 'assistant', content: '该工具不可用' };
      },
    ]);
    const agent = new Agent({ id: 'ag_3', systemPrompt: 'x', llm: client });

    const result = await agent.run('调用工具');
    expect(result.text).toBe('该工具不可用');
    expect(result.toolCalls[0]!.result.ok).toBe(false);
  });

  it('工具执行抛错：错误信息回填给 LLM', async () => {
    const boom: Tool = {
      name: 'boom',
      description: '总是失败',
      execute: async () => {
        throw new Error('磁盘满了');
      },
    };
    const { client } = createMockLLM([
      () => ({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'boom', arguments: {} }],
      }),
      (messages) => {
        const toolMsg = messages.find((m) => m.role === 'tool');
        expect(toolMsg?.content).toContain('磁盘满了');
        return { role: 'assistant', content: '稍后再试' };
      },
    ]);
    const agent = new Agent({ id: 'ag_4', systemPrompt: 'x', llm: client, tools: [boom] });

    const result = await agent.run('执行');
    expect(result.toolCalls[0]!.result.ok).toBe(false);
    expect(result.toolCalls[0]!.result.error).toBe('磁盘满了');
  });

  it('maxIterations 超限：抛错终止', async () => {
    const { client, chat } = createMockLLM([
      () => ({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'calculator', arguments: { expression: '1 + 1' } }],
      }),
      () => ({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c2', name: 'calculator', arguments: { expression: '2 + 2' } }],
      }),
    ]);
    const agent = new Agent({
      id: 'ag_5',
      systemPrompt: 'x',
      llm: client,
      tools: [calculator],
    });

    await expect(agent.run('算', { maxIterations: 2 })).rejects.toThrow('maxIterations');
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('extraSystemPrompt 叠加在 systemPrompt 之后', async () => {
    const { client, chat } = createMockLLM([
      (messages) => {
        expect(messages[0]!.content).toBe('你是助手\n\n今天只说中文');
        return { role: 'assistant', content: '好的' };
      },
    ]);
    const agent = new Agent({
      id: 'ag_6',
      systemPrompt: '你是助手',
      llm: client,
    });

    const result = await agent.run('你好', { extraSystemPrompt: '今天只说中文' });
    expect(result.text).toBe('好的');
    void chat;
  });
});

describe('ToolRegistry', () => {
  it('重复注册同名工具抛错', () => {
    const registry = new ToolRegistry();
    registry.register(calculator);
    expect(() => registry.register(calculator)).toThrow('already registered');
  });

  it('toDefinitions 输出 OpenAI 兼容 function 声明', () => {
    const registry = new ToolRegistry().register(calculator);
    const defs = registry.toDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]).toEqual({
      type: 'function',
      function: {
        name: 'calculator',
        description: '四则运算',
        parameters: {
          type: 'object',
          properties: { expression: { type: 'string' } },
          required: ['expression'],
        },
      },
    });
  });

  it('缺省 parameters 时兜底为空对象 schema', () => {
    const registry = new ToolRegistry().register({
      name: 'no-params',
      description: '无参数',
      execute: async (): Promise<ToolResult> => ({ ok: true, output: 'done' }),
    });
    expect(registry.toDefinitions()[0]!.function.parameters).toEqual({
      type: 'object',
      properties: {},
    });
  });
});
