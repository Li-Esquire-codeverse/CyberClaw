/**
 * OpenAI 兼容端点类型（最小子集，覆盖 95% 客户端接入需求，见 spec ADR-3）。
 *
 * 只实现 /v1/models + /v1/chat/completions（stream 可选）；
 * assistants / embeddings 等 API 列为后续扩展。
 */

/** OpenAI 兼容请求（最小子集） */
export interface OpenAiChatRequest {
  /**
   * model 参数语义（spec §4.4.2，三者都支持）：
   *   - "agent:<agentId>"：显式指定智能体
   *   - agent 名称 或 agent id：按名称/ID 匹配
   *   - 缺省（不传 / 空串）：走多 agent 路由（按消息关键词分发）
   */
  model?: string;
  /** 对话消息（v1 支持 user/assistant；system/tool 被 sanitize 过滤） */
  messages: OpenAiChatMessage[];
  /** true = SSE 流式；false / 缺省 = 聚合返回完整 choices */
  stream?: boolean;
  /** 采样温度：v1 接受但忽略（agent 使用配置中模型的默认采样） */
  temperature?: number;
}

/** OpenAI 消息（content 在 OpenAI 协议中可能是数组，v1 仅支持字符串） */
export interface OpenAiChatMessage {
  role: string;
  content: string;
}

/** OpenAI 风格错误对象（统一由 toOpenAiError 生成） */
export interface OpenAiError {
  message: string;
  type: string;
  code?: string;
}

/** GET /v1/models 返回项 */
export interface OpenAiModelInfo {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}
