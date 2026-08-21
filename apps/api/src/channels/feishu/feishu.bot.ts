import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ClawConfigService } from '../../claw/claw-config.service';
import { ChatService } from '../../chat/chat.service';
import { SseRenderer } from './feishu.renderer';
import type { FeishuClientPort, FeishuIncomingMessage } from './feishu.lark-client';
import type { FeishuSessionStore } from './feishu.sessions';

/**
 * 飞书渠道服务：消息 → buildAgent + streamChat → SSE 事件渲染 → 回复。
 *
 * 规则：
 *   - 缺凭据（client 为 null）→ 不启动（优雅降级）
 *   - 只处理 text 消息；群聊仅 @机器人 才响应
 *   - FEISHU_ALLOWED_USERS 白名单（open_id 逗号分隔，可选）
 *   - agent 选择：FEISHU_AGENT_ID ?? 第一个启用 agent
 *   - 会话映射：chat_id → conversationId（FeishuSessions 持久化）
 */
export const FEISHU_CLIENT = Symbol('FEISHU_CLIENT');
export const FEISHU_SESSIONS = Symbol('FEISHU_SESSIONS');

@Injectable()
export class FeishuBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeishuBotService.name);
  private started = false;

  constructor(
    private readonly chatService: ChatService,
    private readonly configService: ClawConfigService,
    @Inject(FEISHU_CLIENT)
    private readonly client: FeishuClientPort | null,
    @Inject(FEISHU_SESSIONS)
    private readonly sessions: FeishuSessionStore,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.client) {
      // 缺凭据时 module 注入 null，静默跳过（WARN 已在 module 工厂打）
      return;
    }
    await this.client.start((msg) => this.handleMessage(msg));
    this.started = true;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.started && this.client) {
      await this.client.stop();
    }
  }

  /** 当前绑定的 agentId（环境变量优先，否则第一个启用 agent） */
  private resolveAgentId(): string | undefined {
    const env = process.env.FEISHU_AGENT_ID?.trim();
    if (env) return env;
    const config = this.configService.loadConfig();
    const enabled = config.agents.find((a) => a.enabled);
    return enabled?.id;
  }

  private allowed(openId: string): boolean {
    const raw = process.env.FEISHU_ALLOWED_USERS?.trim();
    if (!raw) return true;
    return raw.split(',').map((s) => s.trim()).includes(openId);
  }

  /** 供调度等模块推送消息到指定飞书会话（无 client 时静默跳过） */
  async sendTextToChat(chatId: string, text: string): Promise<void> {
    if (!this.client) return;
    await this.client.sendText(chatId, text);
  }

  async handleMessage(msg: FeishuIncomingMessage): Promise<void> {
    if (!this.client) return;

    // 只处理文本消息
    if (msg.messageType !== 'text' || !msg.text.trim()) return;
    // 群聊：仅 @机器人 才响应
    if (msg.chatType === 'group' && !msg.mentionBot) return;
    // 白名单
    if (!this.allowed(msg.senderOpenId)) return;

    const agentId = this.resolveAgentId();
    if (!agentId) {
      await this.client.sendText(msg.chatId, '⚠️ 没有可用的智能体，请先在配置中创建并启用');
      return;
    }

    const conversationId = this.sessions.getOrCreate(msg.chatId, agentId);

    try {
      const built = await this.chatService.buildAgent(agentId);
      const renderer = new SseRenderer();
      for await (const evt of this.chatService.streamChat(
        built,
        [{ role: 'user', content: msg.text }],
        undefined,
        conversationId,
      )) {
        for (const action of renderer.ingest(evt)) {
          if (action.kind === 'tool_status') {
            const state =
              action.ok === undefined ? '执行中…' : action.ok ? '✅ 完成' : '❌ 失败';
            await this.client.sendText(msg.chatId, `🔧 ${action.tool} ${state}`);
          }
        }
      }
      const finalText = renderer.flush();
      if (finalText) {
        await this.client.sendText(msg.chatId, finalText);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`飞书消息处理失败: ${message}`);
      try {
        await this.client.sendText(msg.chatId, `⚠️ 出错了：${message}`);
      } catch {
        // 发送失败不再抛（避免长连接回调异常）
      }
    }
  }
}
