import type { ToolResult } from './types.js';

export interface ToolContext {
  /** 触发本次执行的智能体名称 */
  agentName?: string;
  /** 中断信号 */
  signal?: AbortSignal;
}

/**
 * 工具协议：name 唯一、description 供 LLM 选工具、
 * parameters 为 JSON Schema、execute 执行并返回结构化结果。
 */
export interface Tool<P = Record<string, unknown>> {
  name: string;
  description: string;
  /** JSON Schema，缺省为空对象 schema */
  parameters?: Record<string, unknown>;
  execute(args: P, context?: ToolContext): Promise<ToolResult>;
}
