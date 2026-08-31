import { Logger, Module } from '@nestjs/common';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { findRepoRoot } from '@cyberclaw/agent-core';
import { ChatModule } from '../chat/chat.module';
import { ClawModule } from '../claw/claw.module';
import { RoutingModule } from '../routing/routing.module';
import {
  FEISHU_CLIENT,
  FEISHU_SESSIONS,
  FeishuBotService,
} from './feishu/feishu.bot';
import { createLarkClient } from './feishu/feishu.lark-client';
import { FeishuSessions } from './feishu/feishu.sessions';

const dbPathOf = (): string => {
  const root = findRepoRoot(process.cwd()) ?? process.cwd();
  return join(root, 'data', 'cyberclaw.db');
};

/**
 * 渠道模块：飞书 bot（长连接）。
 *
 * 优雅降级：未配置 FEISHU_APP_ID / FEISHU_APP_SECRET 时注入 null client，
 * FeishuBotService 启动时静默跳过——不影响 WebUI/API。
 */
@Module({
  imports: [ChatModule, ClawModule, RoutingModule],
  providers: [
    FeishuBotService,
    {
      provide: FEISHU_CLIENT,
      useFactory: () => {
        const appId = process.env.FEISHU_APP_ID?.trim();
        const appSecret = process.env.FEISHU_APP_SECRET?.trim();
        if (!appId || !appSecret) {
          Logger.warn(
            '飞书 bot 未启用：缺少 FEISHU_APP_ID / FEISHU_APP_SECRET（可在飞书开放平台创建应用后配置）',
            'ChannelsModule',
          );
          return null;
        }
        return createLarkClient(appId, appSecret);
      },
    },
    {
      provide: FEISHU_SESSIONS,
      useFactory: () => {
        const path = dbPathOf();
        if (!existsSync(dirname(path))) {
          mkdirSync(dirname(path), { recursive: true });
        }
        return new FeishuSessions(path);
      },
    },
  ],
  exports: [FeishuBotService],
})
export class ChannelsModule {}
