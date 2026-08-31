import type { ChatMessageDto } from '../chat/chat.dto';
import type { ChatService, BuiltAgent } from '../chat/chat.service';
import type { CompactStore } from './compact.store';

/** 压缩阈值（spec §4.4.4）：消息数 > 30 或累计字符 > 20_000 触发 */
export const COMPACT_MAX_MESSAGES = 30;
export const COMPACT_MAX_CHARS = 20_000;
/** 压缩后保留的最近消息条数 */
export const COMPACT_KEEP_RECENT = 10;
/**
 * 二级阈值：摘要复用上限。消息数 ≤ 60 且已有摘要 → 直接复用（零重算）；
 * 超过 60 条说明摘要已滞后，强制重算。
 */
export const COMPACT_SECONDARY_MAX = 60;

/** 摘要 prompt（对齐 OpenClaw transcript 模式，spec §4.4.4） */
export const SUMMARIZE_PROMPT =
  '请用 200 字以内总结以下对话的关键事实与用户偏好，用于延续后续对话。\n\n';

/**
 * 压缩判定（纯函数）：消息数 > 30 || 累计字符 > 20_000。
 * COMPACTION=0 环境变量可关闭（对齐 spec「COMPACTION=0 可关」）。
 */
export function shouldCompact(history: ChatMessageDto[]): boolean {
  if (process.env.COMPACTION === '0') return false;
  if (history.length > COMPACT_MAX_MESSAGES) return true;
  const chars = history.reduce((sum, m) => sum + m.content.length, 0);
  return chars > COMPACT_MAX_CHARS;
}

/**
 * 生成摘要 + 保留最近 10 条（复用调用方已构建的 agent）。
 *
 * 实现：把摘要 prompt 作为 user 消息交给 streamChat（复用既有链路，
 * 记忆/工具/路由自动生效），非流式聚合 content delta 得到摘要文本。
 */
export async function summarizeHistory(input: {
  history: ChatMessageDto[];
  agent: BuiltAgent;
  chatService: ChatService;
}): Promise<{ summary: string; kept: ChatMessageDto[] }> {
  const { history, agent, chatService } = input;
  const transcript = history
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');
  const prompt = SUMMARIZE_PROMPT + transcript;

  let summary = '';
  // skipCompaction=true：摘要生成路径跳过压缩预处理，防止长线程下无限递归
  for await (const evt of chatService.streamChat(
    agent,
    [{ role: 'user', content: prompt }],
    undefined,
    undefined,
    true,
  )) {
    if (evt === '[DONE]') break;
    if ('choices' in evt && evt.choices[0]?.delta?.content) {
      summary += evt.choices[0].delta.content;
    }
  }

  return { summary: summary.trim(), kept: history.slice(-COMPACT_KEEP_RECENT) };
}

/** 压缩结果 */
export interface CompactResult {
  /** 命中的摘要（未压缩或未生成时为 undefined） */
  summary: string | undefined;
  /** 保留给模型使用的近期消息（未压缩时为原历史） */
  kept: ChatMessageDto[];
  /** 本次是否重新生成了摘要（false = 复用了库中摘要或未触发） */
  recomputed: boolean;
}

/**
 * 压缩入口（对齐 OpenClaw transcript 模式，spec §4.4.4 复用逻辑）：
 *   - 未超阈值            → 原样返回（不压缩、不写库）
 *   - 超阈值 && 已有摘要 && 消息数 ≤ 60 → 复用 [库中摘要 + 最近 10 条]，零重算
 *   - 超阈值 && (无摘要 || 消息数 > 60) → 生成一次 → 写库 → [新摘要 + 最近 10 条]
 */
export async function maybeCompact(input: {
  history: ChatMessageDto[];
  agent: BuiltAgent;
  chatService: ChatService;
  conversationId: string;
  store: CompactStore;
}): Promise<CompactResult> {
  const { history, agent, chatService, conversationId, store } = input;

  if (!shouldCompact(history)) {
    return { summary: undefined, kept: history, recomputed: false };
  }

  const existing = store.loadSummary(conversationId);
  if (existing && history.length <= COMPACT_SECONDARY_MAX) {
    return {
      summary: existing,
      kept: history.slice(-COMPACT_KEEP_RECENT),
      recomputed: false,
    };
  }

  const { summary, kept } = await summarizeHistory({ history, agent, chatService });
  if (summary) {
    store.saveSummary(conversationId, summary);
  }
  return { summary: summary || undefined, kept, recomputed: true };
}
