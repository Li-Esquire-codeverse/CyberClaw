import type { ChatMessage } from './types.js';

/** OpenAI 兼容的函数定义（发给 LLM 的可用工具声明） */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    /** JSON Schema */
    parameters: Record<string, unknown>;
  };
}

export interface ChatOptions {
  /** 模型标识，覆盖 Agent 默认 model */
  model?: string;
  tools?: ToolDefinition[];
  temperature?: number;
}

/**
 * LLM 客户端接口（依赖倒置）：
 * agent-core 不绑定具体服务商，由 provider 适配器
 * （OpenAI / DeepSeek / Ollama / 自定义 OpenAI 兼容端点）实现。
 */
export interface LLMClient {
  /**
   * 发起一轮对话，返回 assistant 消息。
   * 若模型决定调用工具，返回消息需带 toolCalls。
   */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatMessage>;
}
