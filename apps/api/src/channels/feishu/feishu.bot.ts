import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ClawConfigService } from '../../claw/claw-config.service';
import { ChatService } from '../../chat/chat.service';
import { RouterService } from '../../routing/router.service';
import { SseRenderer, FEISHU_TEXT_CHUNK_SIZE } from './feishu.renderer';
import type { FeishuClientPort, FeishuIncomingMessage } from './feishu.lark-client';
import type { FeishuSessionStore } from './feishu.sessions';

/**
 * 飞书渠道服务：消息 → buildAgent + streamChat → SSE 事件渲染 → 回复。
 *
 * 规则：
 *   - 缺凭据（client 为 null）→ 不启动（优雅降级）
 *   - 只处理 text 消息；群聊仅 @机器人 才响应
 *   - FEISHU_ALLOWED_USERS 白名单（open_id 逗号分隔，可选）
 *   - agent 选择（Phase 4）：消息关键词路由 → FEISHU_AGENT_ID ?? 第一个启用 agent
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
    private readonly routerService: RouterService,
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

  /**
   * 当前绑定的 agentId（Phase 4 多 agent 路由）：
   *   关键词命中（配置 keywords）→ 分发对应 agent；
   *   无命中 → FEISHU_AGENT_ID ?? 第一个启用 agent（与 Phase 3 完全一致，向后兼容）。
   */
  private resolveAgentId(message: string): string | undefined {
    const config = this.configService.loadConfig();
    return this.routerService.resolveAgentId({
      message,
      agents: config.agents,
      defaultAgentId: process.env.FEISHU_AGENT_ID?.trim() || undefined,
    });
  }

  /**
   * 处理 /agent 命令：
   *   - `/agent` 或 `/agent list` → 列出所有启用智能体
   *   - `/agent <名称|ID>` → 切换到对应智能体（新建会话，独立上下文）
   * 返回是否已作为命令消费（true 时调用方不再走对话流程）。
   */
  private async handleAgentCommand(
    chatId: string,
    raw: string,
  ): Promise<boolean> {
    const text = raw.trim();
    if (!text.startsWith('/agent')) return false;

    const config = this.configService.loadConfig();
    const enabled = config.agents.filter((a) => a.enabled);

    const args = text.replace(/^\/agent\s*/, '').trim();

    // 列出可用智能体
    if (!args || args === 'list' || args === 'help') {
      if (enabled.length === 0) {
        await this.client!.sendText(chatId, '⚠️ 当前没有可用的智能体，请先在配置中创建并启用');
      } else {
        const lines = enabled.map((a) => `- ${a.name}（${a.id}）`);
        await this.client!.sendText(
          chatId,
          `📋 可用智能体：\n${lines.join('\n')}\n\n发送 /agent <名称或ID> 切换`,
        );
      }
      return true;
    }

    // 匹配：ID 精确 → 名称精确 → 名称包含（忽略大小写）
    const target =
      enabled.find((a) => a.id === args) ??
      enabled.find((a) => a.name === args) ??
      enabled.find((a) => a.name.toLowerCase().includes(args.toLowerCase()));

    if (!target) {
      await this.client!.sendText(
        chatId,
        `⚠️ 未找到智能体「${args}」。发送 /agent 查看可用列表`,
      );
      return true;
    }

    const conversationId = this.sessions.switchAgent(chatId, target.id);
    // 同步到 WebUI 会话列表（新会话标题标记来源）
    try {
      this.chatService.upsertConversation({
        id: conversationId,
        agentId: target.id,
        title: `飞书会话（切换至 ${target.name}）`,
        source: 'feishu',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`切换智能体后同步 WebUI 列表失败: ${message}`);
    }
    await this.client!.sendText(chatId, `✅ 已切换到智能体「${target.name}」，新会话已开始`);
    return true;
  }

  /** 按单条上限分段发送长文本（每段加 (i/n) 前缀，n=1 时不加） */
  async sendTextChunked(chatId: string, text: string): Promise<void> {
    if (!this.client) return;
    if (text.length <= FEISHU_TEXT_CHUNK_SIZE) {
      await this.client.sendText(chatId, text);
      return;
    }
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += FEISHU_TEXT_CHUNK_SIZE) {
      chunks.push(text.slice(i, i + FEISHU_TEXT_CHUNK_SIZE));
    }
    for (let i = 0; i < chunks.length; i++) {
      const prefix = chunks.length > 1 ? `（${i + 1}/${chunks.length}）\n` : '';
      await this.client.sendText(chatId, `${prefix}${chunks[i]}`);
    }
  }

  private allowed(openId: string): boolean {
    const raw = process.env.FEISHU_ALLOWED_USERS?.trim();
    if (!raw) return true;
    return raw.split(',').map((s) => s.trim()).includes(openId);
  }

  /** 供调度等模块推送消息到指定飞书会话（无 client 时静默跳过；长文自动分段） */
  async sendTextToChat(chatId: string, text: string): Promise<void> {
    await this.sendTextChunked(chatId, text);
  }

  async handleMessage(msg: FeishuIncomingMessage): Promise<void> {
    if (!this.client) return;

    // 只处理文本消息
    if (msg.messageType !== 'text' || !msg.text.trim()) return;
    // 群聊：仅 @机器人 才响应
    if (msg.chatType === 'group' && !msg.mentionBot) return;
    // 白名单
    if (!this.allowed(msg.senderOpenId)) return;

    // /agent 命令：切换智能体（不进入对话流程）
    if (await this.handleAgentCommand(msg.chatId, msg.text)) return;

    const agentId = this.resolveAgentId(msg.text);
    if (!agentId) {
      await this.client.sendText(msg.chatId, '⚠️ 没有可用的智能体，请先在配置中创建并启用');
      return;
    }

    const conversationId = this.sessions.getOrCreate(msg.chatId, agentId);

    // 同步到 WebUI 会话列表（conversations 表）：飞书会话在 WebUI 可见、可查看历史
    try {
      this.chatService.upsertConversation({
        id: conversationId,
        agentId,
        title: msg.text.trim().slice(0, 30),
        source: 'feishu',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`飞书会话同步到 WebUI 列表失败: ${message}`);
    }

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
        await this.sendTextChunked(msg.chatId, finalText);
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
