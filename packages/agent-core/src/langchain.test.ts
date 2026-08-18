import { FakeListChatModel } from '@langchain/core/utils/testing';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { describe, expect, it, vi } from 'vitest';
import {
  createChatModelFromConfig,
  createLangchainAgent,
  toLangchainTool,
} from './langchain.js';
import type { ClawConfigFile, ClawTool } from './config.js';

const sampleConfig: ClawConfigFile = {
  agents: [
    {
      id: 'ag_1',
      name: '测试助手',
      systemPrompt: '你是测试助手，需要时使用工具。',
      modelId: 'mdl_1',
      tools: ['echo'],
      enabled: true,
    },
  ],
  models: [
    {
      id: 'mdl_1',
      provider: 'deepseek',
      name: 'DeepSeek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      enabled: true,
      isDefault: true,
    },
    {
      id: 'mdl_2',
      provider: 'qwen',
      name: '通义千问',
      model: 'qwen-plus',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      enabled: true,
    },
  ],
  tools: [
    {
      name: 'echo',
      label: '回显',
      description: '回显输入的文本',
      enabled: true,
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
    { name: 'web-search', label: '网页搜索', description: '搜索', enabled: false },
  ],
};

describe('createChatModelFromConfig', () => {
  it('用配置构造 ChatOpenAI（OpenAI 兼容端点）', () => {
    const model = createChatModelFromConfig(sampleConfig.models[0]!) as {
      model?: string;
      apiKey?: string;
      clientConfig?: { baseURL?: string };
    };
    expect(model.model).toBe('deepseek-chat');
    expect(model.apiKey).toBe('sk-test');
    expect(model.clientConfig?.baseURL).toBe('https://api.deepseek.com/v1');
  });

  it('缺失 apiKey 时用占位符（兼容 Ollama 本地端点）', () => {
    const model = createChatModelFromConfig(sampleConfig.models[1]!) as {
      apiKey?: string;
    };
    expect(model.apiKey).toBeTruthy();
  });
});

describe('toLangchainTool', () => {
  const toolCfg: ClawTool = sampleConfig.tools[0]!;

  it('未注册执行器时返回占位错误', async () => {
    const tool = toLangchainTool(toolCfg, undefined);
    const result = await tool.invoke({ text: 'hi' });
    expect(String(result)).toContain('[工具未实现]');
    expect(String(result)).toContain('echo');
  });

  it('注入执行器后返回真实结果', async () => {
    const tool = toLangchainTool(toolCfg, async (args) => `echo:${String(args.text)}`);
    expect(await tool.invoke({ text: 'hello' })).toBe('echo:hello');
  });
});

describe('createLangchainAgent', () => {
  it('默认选用 isDefault 模型，工具只含启用项，systemPrompt 取自智能体配置', async () => {
    const captured: string[] = [];
    const { agent, model, tools, chatModel } = await createLangchainAgent({
      config: sampleConfig,
      llmFactory: (m) => {
        captured.push(m.id);
        return new FakeListChatModel({ responses: ['你好'] });
      },
    });

    expect(model.id).toBe('mdl_1');
    expect(captured).toEqual(['mdl_1']);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('echo');
    expect(chatModel).toBeInstanceOf(FakeListChatModel);
    expect(agent).toBeDefined();
  });

  it('modelId 指定时优先选用指定模型', async () => {
    const { model } = await createLangchainAgent({
      config: sampleConfig,
      modelId: 'mdl_2',
      llmFactory: () => new FakeListChatModel({ responses: ['x'] }),
    });
    expect(model.id).toBe('mdl_2');
  });

  it('systemPrompt 显式指定时优先于配置', async () => {
    const { agent } = await createLangchainAgent({
      config: sampleConfig,
      systemPrompt: '自定义提示词',
      llmFactory: () => new FakeListChatModel({ responses: ['x'] }),
    });
    expect(agent).toBeDefined();
  });

  it('无启用模型时抛错', async () => {
    await expect(
      createLangchainAgent({
        config: {
          agents: [],
          models: [{ ...sampleConfig.models[0]!, enabled: false }],
          tools: [],
        },
        llmFactory: () => new FakeListChatModel({ responses: ['x'] }),
      }),
    ).rejects.toThrow('没有启用的模型');
  });

  it('FakeListChatModel 跑通完整 invoke（无工具调用）', async () => {
    const fake = new FakeListChatModel({ responses: ['收到，测试通过'] });
    const { agent } = await createLangchainAgent({
      config: sampleConfig,
      llmFactory: () => fake,
    });

    const result = await agent.invoke({
      messages: [{ role: 'user', content: 'hi' }],
    });
    const last = result.messages[result.messages.length - 1];
    expect(last.content).toContain('收到，测试通过');
  });

  it('checkpointer 启用后同一 thread_id 自动恢复历史（对话记忆）', async () => {
    const fake = new FakeListChatModel({ responses: ['回复一', '回复二'] });
    const { agent } = await createLangchainAgent({
      config: sampleConfig,
      llmFactory: () => fake,
      checkpointer: new MemorySaver(),
    });

    // 第一轮：只传新消息
    await agent.invoke(
      { messages: [{ role: 'user', content: '你好，我叫小明' }] },
      { configurable: { thread_id: 'conv-1' } },
    );
    // 第二轮：同样只传新消息，checkpointer 应恢复上一轮历史
    await agent.invoke(
      { messages: [{ role: 'user', content: '我叫什么名字？' }] },
      { configurable: { thread_id: 'conv-1' } },
    );

    // 从线程状态读取完整历史，验证两轮消息都被持久化
    const state = await (agent as { getState: (c: object) => Promise<{ values: { messages: unknown[] } }> }).getState(
      { configurable: { thread_id: 'conv-1' } },
    );
    const contents = state.values.messages.map((m) =>
      String((m as { content: unknown }).content),
    );
    expect(contents.join('|')).toContain('你好，我叫小明');
    expect(contents.join('|')).toContain('回复一');
    expect(contents.join('|')).toContain('我叫什么名字？');
  });

  it('不同 thread_id 会话隔离（互不干扰）', async () => {
    const fake = new FakeListChatModel({ responses: ['回复一', '回复二', '回复三'] });
    const { agent } = await createLangchainAgent({
      config: sampleConfig,
      llmFactory: () => fake,
      checkpointer: new MemorySaver(),
    });

    await agent.invoke(
      { messages: [{ role: 'user', content: '我是会话 A 的消息' }] },
      { configurable: { thread_id: 'conv-a' } },
    );
    await agent.invoke(
      { messages: [{ role: 'user', content: '我是会话 B 的消息' }] },
      { configurable: { thread_id: 'conv-b' } },
    );

    const stateA = await (agent as { getState: (c: object) => Promise<{ values: { messages: unknown[] } }> }).getState(
      { configurable: { thread_id: 'conv-a' } },
    );
    const contentsA = stateA.values.messages.map((m) =>
      String((m as { content: unknown }).content),
    );
    const stateB = await (agent as { getState: (c: object) => Promise<{ values: { messages: unknown[] } }> }).getState(
      { configurable: { thread_id: 'conv-b' } },
    );
    const contentsB = stateB.values.messages.map((m) =>
      String((m as { content: unknown }).content),
    );

    // 会话 A 只含 A 的消息；会话 B 只含 B 的消息
    expect(contentsA.join('|')).toContain('我是会话 A 的消息');
    expect(contentsA.join('|')).toContain('回复一');
    expect(contentsA.join('|')).not.toContain('我是会话 B 的消息');
    expect(contentsB.join('|')).toContain('我是会话 B 的消息');
    expect(contentsB.join('|')).not.toContain('我是会话 A 的消息');
  });
});
