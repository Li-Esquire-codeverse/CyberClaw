/**
 * agent-core 核心消息与运行类型
 * 消息形状对齐 OpenAI 兼容协议（role/content/tool_calls/tool_call_id），
 * 便于 OpenAI / DeepSeek / Ollama / 自定义 provider 直接映射。
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** 模型发起的工具调用（arguments 为已解析的 JSON 对象） */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** assistant 消息携带的工具调用列表 */
  toolCalls?: ToolCall[];
  /** tool 消息：对应哪个 tool call（OpenAI 协议 tool_call_id） */
  toolCallId?: string;
  /** tool 消息：来源工具名 */
  name?: string;
}

/** 工具执行结果：output 回填给 LLM 继续决策 */
export interface ToolResult {
  ok: boolean;
  output: string;
  error?: string;
}

/** 一次 run 中实际执行过的工具调用（含参数与结果） */
export interface ExecutedToolCall {
  call: ToolCall;
  result: ToolResult;
}

export interface AgentRunOptions {
  /** 单轮对话最大 LLM 调用次数（含工具往返），默认取 Agent 配置值 */
  maxIterations?: number;
  /** 追加的系统指令（叠加在 systemPrompt 之后） */
  extraSystemPrompt?: string;
}

export interface AgentRunResult {
  /** 最终回复文本 */
  text: string;
  /** 完整消息历史（含 system/user/assistant/tool 往返），便于上层持久化 */
  messages: ChatMessage[];
  /** 实际发生的 LLM 调用次数 */
  iterations: number;
  /** 本次执行过的工具调用 */
  toolCalls: ExecutedToolCall[];
}
