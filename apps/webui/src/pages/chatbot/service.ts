// src/pages/chatbot/service.ts
import { request } from '@umijs/max';
import {
  AbstractChatProvider,
  type TransformMessage,
  XRequest,
  type XRequestOptions,
} from '@ant-design/x-sdk';
import type { SSEOutput } from '@ant-design/x-sdk/es/x-stream';
import type { ToolCallInfo } from './data';

/** 后端对话接口（NestJS SSE，内部走 langchain createAgent） */
export const CHAT_API_URL = '/api/claw/chat';

/** AI 助手消息：content 为最终文本，thinkContent 为思考过程，tools 记录工具调用过程 */
export interface ChatAgentMessage {
  role: 'user' | 'assistant';
  content: string;
  thinkContent?: string;
  tools?: ToolCallInfo[];
}

type ChatInput = {
  agentId?: string;
  stream?: boolean;
  /** 会话 ID：同 ID 请求共享对话历史（后端按 thread_id 持久化） */
  conversationId?: string;
  messages: ChatAgentMessage[];
};

/** 后端 SSE data 字段（OpenAI 兼容 choices + CyberClaw 扩展事件） */
interface SsePayload {
  choices?: {
    delta?: { content?: string; role?: string };
    message?: { content?: string; role?: string };
  }[];
  event?: string;
  agentId?: string;
  agentName?: string;
  tool?: string;
  args?: string;
  ok?: boolean;
  result?: string;
  /** reasoning_delta 事件：模型思考过程增量 */
  reasoning?: string;
}

/**
 * CyberClaw 对话 Provider
 *
 * 请求后端 /api/claw/chat（SSE 流式输出）：
 *  - choices.delta.content：模型生成 token，累积到消息 content（打字机效果）
 *  - reasoning_delta：模型思考过程，累积到消息 thinkContent（思考区实时展示）
 *  - tool_start / tool_end：工具调用过程，记录到消息 tools 供气泡展示
 *  - [DONE]：流结束
 *
 * 会话历史由 useXChat 维护，每次请求通过 transformParams 全量携带。
 */
class CyberClawChatProvider extends AbstractChatProvider<
  ChatAgentMessage,
  ChatInput,
  SSEOutput
> {
  constructor(agentId: string) {
    super({
      request: XRequest<ChatInput, SSEOutput, ChatAgentMessage>(CHAT_API_URL, {
        manual: true,
        params: { agentId, stream: true },
      }),
    });
  }

  transformParams(
    requestParams: Partial<ChatInput>,
    options: XRequestOptions<ChatInput, SSEOutput, ChatAgentMessage>,
  ): ChatInput {
    return {
      ...(options?.params || {}),
      ...requestParams,
      // 只传本轮新消息：历史由后端 langgraph checkpointer 按 conversationId 恢复
      messages: requestParams?.messages || [],
    };
  }

  transformLocalMessage(requestParams: Partial<ChatInput>): ChatAgentMessage[] {
    return requestParams?.messages || [];
  }

  transformMessage(
    info: TransformMessage<ChatAgentMessage, SSEOutput>,
  ): ChatAgentMessage {
    const { originMessage, chunk } = info;
    const tools: ToolCallInfo[] = originMessage?.tools
      ? [...originMessage.tools]
      : [];
    let thinkContent = originMessage?.thinkContent;
    let delta = '';

    try {
      const raw = chunk?.data?.trim();
      if (raw && raw !== '[DONE]') {
        const payload = JSON.parse(raw) as SsePayload;
        if (payload?.choices) {
          for (const choice of payload.choices) {
            const block = choice?.delta ?? choice?.message;
            if (block?.content) delta += block.content;
          }
        } else if (payload?.event === 'reasoning_delta' && payload.reasoning) {
          thinkContent = `${thinkContent || ''}${payload.reasoning}`;
        } else if (payload?.event === 'tool_start' && payload.tool) {
          tools.push({
            id: `${payload.tool}-${tools.length + 1}`,
            tool: payload.tool,
            args: payload.args,
            status: 'running',
          });
        } else if (payload?.event === 'tool_end' && payload.tool) {
          // 找到最近一条同名的 running 记录收尾
          const running = [...tools]
            .reverse()
            .find((t) => t.tool === payload.tool && t.status === 'running');
          if (running) {
            running.status = payload.ok ? 'success' : 'error';
            running.result = payload.result;
            // 完整参数回填（tool_start 时可能只有分片）
            if (payload.args) running.args = payload.args;
          }
        }
      }
    } catch (err) {
      // 忽略无法解析的 SSE 数据，避免中断流
      console.warn('[CyberClawChat] 解析 SSE 数据失败', err);
    }

    return {
      role: 'assistant',
      content: `${originMessage?.content || ''}${delta}`,
      thinkContent,
      tools,
    };
  }
}

/** 会话元数据（Conversations 列表项） */
export interface ConversationRecord {
  id: string;
  agentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** 会话列表：按更新时间倒序 */
export async function loadConversations(
  agentId?: string,
): Promise<ConversationRecord[]> {
  try {
    const res = await request<ConversationRecord[]>(
      `/api/claw/conversations${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''}`,
      { method: 'GET', skipErrorHandler: true },
    );
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

/** 创建/更新会话元数据（标题/时间） */
export async function saveConversation(record: {
  id: string;
  agentId: string;
  title?: string;
}): Promise<ConversationRecord | undefined> {
  try {
    return await request<ConversationRecord>('/api/claw/conversations', {
      method: 'POST',
      data: record,
      skipErrorHandler: true,
    });
  } catch {
    return undefined;
  }
}

/** 删除会话（同时清理后端线程记忆） */
export async function deleteConversation(id: string): Promise<boolean> {
  try {
    await request(`/api/claw/conversations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      skipErrorHandler: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** 历史回显：读取会话线程消息 */
export async function loadHistory(
  agentId: string,
  conversationId: string,
): Promise<ChatAgentMessage[]> {
  try {
    const res = await request<ChatAgentMessage[]>(
      `/api/claw/chat/history?agentId=${encodeURIComponent(agentId)}&conversationId=${encodeURIComponent(conversationId)}`,
      { method: 'GET', skipErrorHandler: true },
    );
    return Array.isArray(res) ? res : [];
  } catch (err) {
    // 提取后端校验错误（如「智能体关联的大模型未启用」），供页面提示而非静默清空历史
    const detail =
      (err as { response?: { data?: { message?: string } } }).response?.data
        ?.message ?? (err as Error).message ?? '未知错误';
    throw new Error(detail);
  }
}

/** Factory — 每个 agentId 实例化一次（组件内用 useMemo 包裹） */
export const createChatProvider = (agentId: string) =>
  new CyberClawChatProvider(agentId);
