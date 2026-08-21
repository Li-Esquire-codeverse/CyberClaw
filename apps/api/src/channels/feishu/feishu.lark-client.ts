import { Logger } from '@nestjs/common';
import * as lark from '@larksuiteoapi/node-sdk';

/**
 * 飞书开放平台适配器（@larksuiteoapi/node-sdk 薄封装）。
 *
 * 通过 FeishuClientPort 接口注入 FeishuBotService——单测用 fake 实现，
 * 真实 SDK 调用不进入单元测试。
 *
 * 模式：WebSocket 长连接（事件订阅 im.message.receive_v1），免公网回调。
 * 用法要点（SDK README）：
 *   - EventDispatcher 作为 wsClient.start({ eventDispatcher }) 参数传入
 *   - 事件回调 data 为扁平结构（data.message / data.sender）
 *   - 发消息用 client.im.v1.message.create
 */

/** 飞书入站消息（已解析，与 SDK 原始结构解耦） */
export interface FeishuIncomingMessage {
  chatId: string;
  chatType: 'p2p' | 'group';
  messageType: string;
  /** 文本内容（仅 text 消息有） */
  text: string;
  senderOpenId: string;
  /** 群聊中是否 @了机器人 */
  mentionBot: boolean;
}

/** 渠道能力端口（bot 逻辑依赖的抽象） */
export interface FeishuClientPort {
  start(onMessage: (msg: FeishuIncomingMessage) => void | Promise<void>): Promise<void>;
  stop(): Promise<void>;
  sendText(chatId: string, text: string): Promise<void>;
}

const logger = new Logger('FeishuClient');

/** 用官方 SDK 创建真实客户端 */
export function createLarkClient(
  appId: string,
  appSecret: string,
): FeishuClientPort {
  const client = new lark.Client({ appId, appSecret });

  let onMessageCb:
    | ((msg: FeishuIncomingMessage) => void | Promise<void>)
    | undefined;

  const dispatcher = new lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      const msg = data?.message;
      if (!msg || !onMessageCb) return;

      const chatType: 'p2p' | 'group' =
        msg.chat_type === 'group' ? 'group' : 'p2p';
      const messageType = msg.message_type ?? '';

      let text = '';
      if (messageType === 'text' && typeof msg.content === 'string') {
        try {
          text = (JSON.parse(msg.content) as { text?: string }).text ?? '';
        } catch {
          text = '';
        }
      }

      const mentions = Array.isArray(msg.mentions) ? msg.mentions : [];
      // @机器人 判断：mentions 中 mentioned_type === 'bot'（无需查询机器人 id）
      const mentionBot = mentions.some((m) => m.mentioned_type === 'bot');

      await onMessageCb({
        chatId: msg.chat_id ?? '',
        chatType,
        messageType,
        text,
        senderOpenId: data?.sender?.sender_id?.open_id ?? '',
        mentionBot,
      });
    },
  });

  const wsClient = new lark.WSClient({ appId, appSecret });

  return {
    async start(onMessage) {
      onMessageCb = onMessage;
      await wsClient.start({ eventDispatcher: dispatcher });
      logger.log('飞书 bot 长连接已启动');
    },
    async stop() {
      try {
        await wsClient.close();
      } catch (err) {
        logger.warn(`飞书长连接停止异常: ${err instanceof Error ? err.message : err}`);
      }
    },
    async sendText(chatId, text) {
      await client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });
    },
  };
}
