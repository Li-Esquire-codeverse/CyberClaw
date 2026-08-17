import type { LLMClient } from './llm.js';
import { ToolRegistry } from './registry.js';
import type { Tool } from './tool.js';
import type {
  AgentRunOptions,
  AgentRunResult,
  ChatMessage,
  ExecutedToolCall,
  ToolCall,
  ToolResult,
} from './types.js';

export interface AgentOptions {
  /** 唯一标识 */
  id: string;
  name?: string;
  systemPrompt: string;
  /** 默认模型标识，可被 run() 覆盖（留空则由 LLMClient 自己决定） */
  model?: string;
  llm: LLMClient;
  /** 可用工具（或注册表） */
  tools?: Tool[] | ToolRegistry;
  /** 默认最大迭代数（LLM 往返次数），默认 10 */
  maxIterations?: number;
}

/**
 * 智能体最小可运行循环：
 *   user 输入 → LLM → 需要工具？→ 执行工具 → 结果回填 → 再调 LLM → …
 *   → 无工具调用 → 返回最终回复
 *
 * 每次 LLM 往返都携带完整消息历史（含 tool 结果），保证模型上下文连续。
 */
export class Agent {
  readonly id: string;
  readonly name?: string;
  readonly systemPrompt: string;
  readonly model?: string;
  readonly llm: LLMClient;
  readonly tools: ToolRegistry;
  private readonly defaultMaxIterations: number;

  constructor(options: AgentOptions) {
    this.id = options.id;
    this.name = options.name;
    this.systemPrompt = options.systemPrompt;
    this.model = options.model;
    this.llm = options.llm;
    this.tools =
      options.tools instanceof ToolRegistry
        ? options.tools
        : new ToolRegistry().registerAll(options.tools ?? []);
    this.defaultMaxIterations = options.maxIterations ?? 10;
  }

  async run(input: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
    const maxIterations = options.maxIterations ?? this.defaultMaxIterations;
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: options.extraSystemPrompt
          ? `${this.systemPrompt}\n\n${options.extraSystemPrompt}`
          : this.systemPrompt,
      },
      { role: 'user', content: input },
    ];
    const executed: ExecutedToolCall[] = [];
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations += 1;
      const reply = await this.llm.chat(messages, {
        model: this.model,
        tools: this.tools.size() > 0 ? this.tools.toDefinitions() : undefined,
      });

      if (reply.toolCalls && reply.toolCalls.length > 0) {
        // 把 assistant 的工具调用原样记入历史，再逐个执行并回填结果
        messages.push(reply);
        for (const call of reply.toolCalls) {
          const result = await this.executeTool(call);
          executed.push({ call, result });
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: result.output,
          });
        }
        continue;
      }

      messages.push({ role: 'assistant', content: reply.content });
      return { text: reply.content, messages, iterations, toolCalls: executed };
    }

    throw new Error(
      `Agent "${this.name ?? this.id}" exceeded maxIterations (${maxIterations})`,
    );
  }

  private async executeTool(call: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      const error = `Tool "${call.name}" is not registered`;
      // 错误信息同样回填给 LLM，让模型能感知并修正（比如换个工具）
      return { ok: false, output: `[工具错误] ${error}`, error };
    }
    try {
      return await tool.execute(call.arguments ?? {}, { agentName: this.name });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false, output: `[工具错误] ${error}`, error };
    }
  }
}
