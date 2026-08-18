import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
} from '@langchain/core/messages';
import type {
  CreatedLangchainAgent,
  ToolExecutor,
} from '@cyberclaw/agent-core';
import { ClawConfigService } from '../claw/claw-config.service';
import type { ClawAgent } from '../claw/claw.types';
import type { ChatMessageDto } from './chat.dto';

/** 构建完成的 agent 及其配置元信息 */
export interface BuiltAgent {
  created: CreatedLangchainAgent;
  agent: ClawAgent;
}

/**
 * SSE 事件负载（即每个 data: 字段的 JSON）：
 *  - choices 结构对齐 OpenAI 兼容协议，前端可复用标准 delta 累积逻辑
 *  - event 事件（tool_start / tool_end）为 CyberClaw 扩展
 *  - '[DONE]' 表示流结束
 */
export type ChatSseEvent =
  | {
      event: string;
      agentId?: string;
      agentName?: string;
      tool?: string;
      args?: string;
      ok?: boolean;
      result?: string;
      message?: string;
    }
  | { event: 'reasoning_delta'; reasoning: string }
  | { choices: { delta: { role: 'assistant'; content: string } }[] }
  | '[DONE]';

/** tool_end 结果回填长度上限，避免超大工具结果撑爆 SSE 事件 */
const TOOL_RESULT_MAX_LEN = 1000;

/**
 * 流式消息 chunk 的形状（duck-typing）。
 *
 * 注意：agent-core 为 ESM 包，本工程（CJS）经 require(esm) 加载，
 * langchain 存在双包（ESM/CJS 两份实例），跨包 instanceof 会失效，
 * 因此这里按运行时形状（constructor 字段）做结构判断：
 *   - 模型输出：AIMessageChunk，含 tool_call_chunks 数组
 *   - 工具结果：ToolMessage，含 tool_call_id 字符串 + name
 */
interface StreamedChunkLike {
  content?: unknown;
  name?: string;
  tool_call_chunks?: { id?: string; name?: string; args?: string }[];
  tool_call_id?: string;
  /** langchain 透传的非标准字段（DeepSeek R1 / Qwen3 的 reasoning_content） */
  additional_kwargs?: Record<string, unknown>;
}

/** 模型生成的 token / 工具调用声明（AIMessageChunk） */
function isModelChunk(chunk: unknown): chunk is StreamedChunkLike & {
  content: unknown;
  tool_call_chunks: { id?: string; name?: string; args?: string }[];
} {
  return (
    typeof chunk === 'object' &&
    chunk !== null &&
    Array.isArray((chunk as StreamedChunkLike).tool_call_chunks) &&
    'content' in chunk
  );
}

/** 工具执行结果（ToolMessage） */
function isToolMessage(
  chunk: unknown,
): chunk is StreamedChunkLike & { name?: string; content: unknown } {
  return (
    typeof chunk === 'object' &&
    chunk !== null &&
    typeof (chunk as StreamedChunkLike).tool_call_id === 'string'
  );
}

/** 工具执行器注入 token：
 *  { provide: CHAT_TOOL_EXECUTORS, useValue: { 'web-search': impl, ... } } */
export const CHAT_TOOL_EXECUTORS = Symbol('CHAT_TOOL_EXECUTORS');

/**
 * AI 助手对话服务
 *
 * 读取 CyberClaw.json（agents / models / tools）并用 langchain 的
 * createAgent（见 packages/agent-core）构建智能体，随后以流式方式
 * 执行对话并输出 OpenAI 兼容的 SSE 事件。
 *
 * 工具执行器（toolExecutors）为注入点：默认无实现（调用时返回
 * 「[工具未实现]」占位，agent 可据此继续作答），后续接入真实工具
 * （搜索 / 浏览器 / 代码执行等）时在此注入即可。
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly configService: ClawConfigService,
    /** 工具执行器注入点：name -> 实现（可选，未注入时工具返回占位错误） */
    @Optional()
    @Inject(CHAT_TOOL_EXECUTORS)
    private readonly toolExecutors: Record<string, ToolExecutor> = {},
  ) {}

  /**
   * 读取配置并构建 langchain agent。
   * 校验失败时抛 HttpException（Nest 返回普通 JSON 错误响应）；
   * 只有构建成功后，调用方才开启 SSE 流。
   */
  async buildAgent(agentId: string): Promise<BuiltAgent> {
    const config = this.configService.loadConfig();
    const agent = config.agents.find((a) => a.id === agentId);
    if (!agent) {
      throw new NotFoundException(`智能体不存在: ${agentId}`);
    }
    if (!agent.enabled) {
      throw new UnprocessableEntityException(
        `智能体「${agent.name}」已停用，请先在「智能体配置」中启用`,
      );
    }
    if (
      agent.modelId &&
      !config.models.some((m) => m.id === agent.modelId && m.enabled)
    ) {
      throw new UnprocessableEntityException(
        `智能体「${agent.name}」关联的大模型未启用，请先在「模型配置」中启用`,
      );
    }

    // @cyberclaw/agent-core 为 ESM 包：Node ≥22.12 原生支持 require(esm)，
    // 用 require 而非动态 import，保证 Jest（无 --experimental-vm-modules）也能运行。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createLangchainAgent } =
      require('@cyberclaw/agent-core') as typeof import('@cyberclaw/agent-core');
    const created = await createLangchainAgent({
      config,
      modelId: agent.modelId,
      systemPrompt: agent.systemPrompt,
      toolExecutors: this.toolExecutors,
    });
    return { created, agent };
  }

  /** 将前端消息历史转换为 langchain BaseMessage */
  private toLangchainMessages(messages: ChatMessageDto[]): BaseMessage[] {
    return messages.map((m) =>
      m.role === 'assistant'
        ? new AIMessage(m.content)
        : new HumanMessage(m.content),
    );
  }

  private static textOf(content: unknown): string {
    if (typeof content === 'string') return content;
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }

  /**
   * 流式执行对话，逐个产出 SSE 事件：
   *   1. agent_start          —— 会话开始（含智能体信息）
   *   2. choices.delta.content —— 模型生成 token（打字机效果）
   *   3. tool_start / tool_end —— 工具调用过程
   *   4. '[DONE]'              —— 正常结束
   *
   * 流中途出错（如模型服务异常）会向上抛出，由 Controller 转成
   * SSE error 内容收尾；客户端断开时通过 signal 中止执行。
   */
  async *streamChat(
    built: BuiltAgent,
    messages: ChatMessageDto[],
    signal?: AbortSignal,
  ): AsyncGenerator<ChatSseEvent, void, void> {
    const { created, agent } = built;

    const history = this.toLangchainMessages(messages);
    if (history.length === 0) {
      throw new UnprocessableEntityException('消息列表不能为空');
    }

    yield { event: 'agent_start', agentId: agent.id, agentName: agent.name };

    const seenToolIds = new Set<string>();
    // 注：langchain 新版 stream() 的泛型推断（TEncoding/TStreamMode）存在缺陷，
    // 运行时实际形状为 [BaseMessage, metadata] 二元组（StreamMessageOutput），
    // 这里按运行时形状显式断言。
    const stream = (await created.agent.stream(
      { messages: history },
      { streamMode: 'messages', recursionLimit: 100, signal },
    )) as unknown as AsyncIterable<[BaseMessage, { langgraph_node?: string }]>;

    for await (const [chunk] of stream) {
      if (isModelChunk(chunk)) {
        // 思考过程增量（langchain 将 delta.reasoning_content 透传到 additional_kwargs）
        const reasoning =
          typeof chunk.additional_kwargs?.reasoning_content === 'string'
            ? chunk.additional_kwargs.reasoning_content
            : '';
        if (reasoning) {
          yield { event: 'reasoning_delta', reasoning };
        }
        // 模型生成的 token 增量
        const text = typeof chunk.content === 'string' ? chunk.content : '';
        if (text) {
          yield { choices: [{ delta: { role: 'assistant', content: text } }] };
        }
        // 工具调用参数流式到来，首个带 name 的 chunk 触发 tool_start
        for (const tc of chunk.tool_call_chunks) {
          if (tc.id && tc.name && !seenToolIds.has(tc.id)) {
            seenToolIds.add(tc.id);
            yield {
              event: 'tool_start',
              tool: tc.name,
              args: tc.args?.slice(0, 500),
            };
          }
        }
      } else if (isToolMessage(chunk)) {
        // 工具执行结果（占位实现返回「[工具未实现]」时视为失败）
        const content = ChatService.textOf(chunk.content);
        const ok =
          !content.includes('[工具错误]') && !content.includes('[工具未实现]');
        yield {
          event: 'tool_end',
          tool: chunk.name ?? 'tool',
          ok,
          result: content.slice(0, TOOL_RESULT_MAX_LEN),
        };
      }
      // 其余消息类型（system / 初始 human 历史）不产生可见事件
    }

    yield '[DONE]';
  }
}
