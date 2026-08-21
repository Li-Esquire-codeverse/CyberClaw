import type { ChatSseEvent } from '../../chat/chat.service';

/**
 * SSE 事件 → 飞书消息 渲染纯函数（零 IO，可单测）。
 *
 * 规则：
 *   - reasoning_delta → 忽略（避免思考刷屏）
 *   - choices[].delta.content → 累积正文（不逐 token 发送，[DONE] 后整发）
 *   - tool_start → tool_status(running)；tool_end → tool_status(ok?)
 *   - [DONE] → flush() 返回最终正文（超长截断提示）
 *
 * 飞书文本消息上限较高，但防御性截断防止异常超长回复。
 */
const MAX_TEXT_LEN = 100_000;

export type RenderAction =
  | { kind: 'tool_status'; tool: string; ok?: boolean }
  | { kind: 'text'; text: string };

export class SseRenderer {
  private content = '';
  private done = false;

  /** 消费一个 SSE 事件，返回 0~1 个要立即发送的动作（工具提示等） */
  ingest(evt: ChatSseEvent): RenderAction[] {
    if (this.done) return [];

    if (evt && typeof evt === 'object' && 'event' in evt) {
      const e = evt as { event: string; tool?: string; ok?: boolean };
      if (e.event === 'tool_start' && e.tool) {
        return [{ kind: 'tool_status', tool: e.tool }];
      }
      if (e.event === 'tool_end' && e.tool) {
        return [{ kind: 'tool_status', tool: e.tool, ok: e.ok }];
      }
      // agent_start / reasoning_delta 不产生发送动作
      return [];
    }

    if (evt && typeof evt === 'object' && 'choices' in evt) {
      const choices = (evt as { choices?: { delta?: { content?: string } }[] })
        .choices;
      for (const c of choices ?? []) {
        const text = c?.delta?.content ?? '';
        if (text) this.content += text;
      }
    }
    return [];
  }

  /** [DONE] 后调用：返回最终正文（无内容返回 null）；重复调用返回 null */
  flush(): string | null {
    if (this.done) return null;
    this.done = true;
    const text = this.content.trim();
    if (!text) return null;
    if (text.length > MAX_TEXT_LEN) {
      return `${text.slice(0, MAX_TEXT_LEN)}\n…（回复过长已截断）`;
    }
    return text;
  }
}
