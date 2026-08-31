import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { ClawModule } from '../claw/claw.module';
import { OpenAiController } from './openai.controller';

/**
 * OpenAI 兼容端点模块（零新依赖，spec ADR-3）：
 *   GET  /v1/models
 *   POST /v1/chat/completions（stream 可选）
 *
 * 复用 ChatModule（buildAgent + streamChat，含记忆/工具/多 agent 路由）
 * 与 ClawModule（配置读取），协议差异收敛在 openai.translate.ts。
 */
@Module({
  imports: [ChatModule, ClawModule],
  controllers: [OpenAiController],
})
export class OpenAiModule {}
