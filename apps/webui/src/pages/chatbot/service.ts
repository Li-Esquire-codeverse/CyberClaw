// src/pages/chatbot/service.ts
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
      messages: this.getMessages(),
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

/** Factory — 每个 agentId 实例化一次（组件内用 useMemo 包裹） */
export const createChatProvider = (agentId: string) =>
  new CyberClawChatProvider(agentId);
