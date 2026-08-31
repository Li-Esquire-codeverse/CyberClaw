import { HttpException } from '@nestjs/common';
import type { ChatSseEvent } from '../chat/chat.service';
import type { ChatMessageDto } from '../chat/chat.dto';
import type { OpenAiChatMessage, OpenAiError } from './openai.types';

/**
 * OpenAI SSE 数据行（不含 "data: " 前缀，由调用方拼装）。
 * choices 结构对齐 OpenAI chat.completion.chunk 协议。
 */
export interface OpenAiDelta {
  role?: 'assistant';
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: { name?: string; arguments?: string };
  }>;
}

export type OpenAiStreamLine =
  | { choices: Array<{ index: number; delta: OpenAiDelta }> }
  | { error: OpenAiError };

/**
 * 翻译上下文：维护 OpenAI 协议要求的状态。
 *  - toolIndex：同轮多次工具调用的 index 递增（协议要求）
 *  - lastToolIndex：tool_end 回填完整 arguments 时定位到对应 tool_call
 *  - started：是否已输出首条 delta（OpenAI 客户端要求首个 chunk 带 role: 'assistant'）
 */
export interface TranslateContext {
  toolIndex: number;
  lastToolIndex: number;
  started: boolean;
  /** 每个 tool_call index 已发出的 arguments 前缀（tool_end 时计算剩余增量） */
  sentArgs: Map<number, string>;
}

export function createTranslateContext(): TranslateContext {
  return {
    toolIndex: 0,
    lastToolIndex: -1,
    started: false,
    sentArgs: new Map(),
  };
}

/**
 * SSE 事件 → OpenAI SSE 数据行（纯函数；返回 null = 该事件不产生输出行）。
 *
 * 映射矩阵（spec §4.4.3）：
 *   agent_start     → null（仅记录，不输出）
 *   reasoning_delta → null（OpenAI 协议无思考字段，v1 决策忽略）
 *   choices content → delta.content（首行补 role: 'assistant'）
 *   tool_start      → delta.tool_calls 新增（id/name/arguments 增量）
 *   tool_end        → delta.tool_calls 回填完整 arguments（tool_start 可能只含首分片）
 *   [DONE]          → null（调用方自行输出 "data: [DONE]"）
 *   未知扩展事件    → null（忽略）
 */
export function translateSseEvent(
  evt: ChatSseEvent,
  ctx: TranslateContext,
): OpenAiStreamLine | null {
  if (evt === '[DONE]') return null;

  // 模型 token 增量 → OpenAI content delta
  if ('choices' in evt && Array.isArray(evt.choices)) {
    const content = evt.choices[0]?.delta?.content;
    if (!content) return null;
    const delta: OpenAiDelta = { content };
    if (!ctx.started) {
      delta.role = 'assistant';
      ctx.started = true;
    }
    return { choices: [{ index: 0, delta }] };
  }

  if ('event' in evt) {
    switch (evt.event) {
      case 'agent_start':
        // 会话开始：仅记录，不产生 OpenAI 行
        return null;

      case 'reasoning_delta':
        // 思考增量：OpenAI 协议无对应字段，v1 决策忽略
        return null;

      case 'tool_start': {
        const index = ctx.toolIndex++;
        ctx.lastToolIndex = index;
        ctx.sentArgs.set(index, evt.args ?? '');
        const delta: OpenAiDelta = {
          tool_calls: [
            {
              index,
              id: `call_${index}`,
              type: 'function',
              function: {
                name: evt.tool ?? 'tool',
                arguments: evt.args ?? '',
              },
            },
          ],
        };
        if (!ctx.started) {
          delta.role = 'assistant';
          ctx.started = true;
        }
        return { choices: [{ index: 0, delta }] };
      }

      case 'tool_end': {
        // OpenAI 协议中 arguments 是增量拼接：客户端对同一 index 逐片追加。
        // tool_start 已发前缀片段（可能为空），此处只发剩余部分，保证客户端
        // 拼接结果 = 完整参数（chat.service 中 tool_end 回填的是完整 args）。
        const index = ctx.lastToolIndex >= 0 ? ctx.lastToolIndex : 0;
        const full = evt.args ?? '';
        const sent = ctx.sentArgs.get(index) ?? '';
        const remaining = full.startsWith(sent) ? full.slice(sent.length) : full;
        return {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index, function: { arguments: remaining } }],
              },
            },
          ],
        };
      }

      default:
        // 未知扩展事件（error 等）：忽略（错误由 toOpenAiError 统一处理）
        return null;
    }
  }

  return null;
}

/** HTTP 状态码 → OpenAI 错误 type 惯例 */
const ERROR_TYPE_BY_STATUS: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'invalid_request_error',
  422: 'invalid_request_error',
  429: 'rate_limit_error',
  500: 'server_error',
  502: 'server_error',
  503: 'server_error',
};

/**
 * 任意异常 → OpenAI 风格错误对象（映射 message / type / code，附 HTTP 状态码）。
 */
export function toOpenAiError(err: unknown): { error: OpenAiError } {
  const status = err instanceof HttpException ? err.getStatus() : 500;
  const raw = err instanceof HttpException ? err.getResponse() : undefined;
  let message: string;
  if (typeof raw === 'string') {
    message = raw;
  } else if (raw && typeof raw === 'object' && 'message' in raw) {
    message = String((raw as { message: unknown }).message);
  } else {
    message = err instanceof Error ? err.message : String(err);
  }
  return {
    error: {
      message,
      type: ERROR_TYPE_BY_STATUS[status] ?? 'server_error',
      code: String(status),
    },
  };
}

/**
 * 消息预处理：OpenAI 客户端可能携带 ChatService 不支持的 role。
 *  - system → 丢弃（agent 的 systemPrompt 已由 buildAgent 注入，外部指令 v1 忽略）
 *  - tool   → 丢弃（工具由 agent 自动执行并回填，客户端无需回传工具结果）
 *  - user/assistant → 保留；content 非字符串时转字符串（容忍多模态数组）
 *  - 其余 role → 抛 400 invalid_request_error
 */
export function sanitizeOpenAiMessages(
  messages: OpenAiChatMessage[],
): ChatMessageDto[] {
  const out: ChatMessageDto[] = [];
  for (const m of messages) {
    if (m.role === 'system' || m.role === 'tool') continue;
    if (m.role !== 'user' && m.role !== 'assistant') {
      throw new HttpException(`不支持的 message role: ${m.role}`, 400);
    }
    out.push({
      role: m.role,
      content:
        typeof m.content === 'string'
          ? m.content
          : JSON.stringify(m.content),
    });
  }
  return out;
}
