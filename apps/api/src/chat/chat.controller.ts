import { Body, Controller, Logger, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ChatRequestDto } from './chat.dto';
import { ChatService } from './chat.service';

/**
 * AI 助手对话接口（SSE 流式输出）
 *
 *  - POST /api/claw/chat
 *    body: { agentId: string, messages: [{role, content}...], stream?: boolean }
 *
 * 读取 CyberClaw.json 中智能体配置（systemPrompt / 大模型 / 工具），
 * 用 langchain createAgent 执行对话，以 OpenAI 兼容 SSE 事件流返回：
 *
 *   data: {"event":"agent_start","agentId":"...","agentName":"..."}
 *   data: {"choices":[{"delta":{"content":"你"}}]}
 *   data: {"event":"tool_start","tool":"web-search",...}
 *   data: {"event":"tool_end","tool":"web-search","ok":true,...}
 *   data: [DONE]
 */
@Controller('claw/chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chatService: ChatService) {}

  @Post()
  async chat(@Body() dto: ChatRequestDto, @Res() res: Response): Promise<void> {
    // 先构建 agent：校验失败时由 Nest 返回普通 JSON 错误（如 404/422），
    // 成功后才设置 SSE 头进入流式阶段，避免错误响应被当作事件流。
    const built = await this.chatService.buildAgent(dto.agentId);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const abortController = new AbortController();
    // 客户端断开（刷新/取消/关闭）时中止 agent 执行
    res.on('close', () => abortController.abort());

    try {
      for await (const event of this.chatService.streamChat(
        built,
        dto.messages ?? [],
        abortController.signal,
      )) {
        if (res.destroyed || res.writableEnded) {
          return;
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      if (!res.destroyed && !res.writableEnded) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Chat stream failed (agent=${dto.agentId}): ${message}`,
      );
      if (!res.destroyed && !res.writableEnded) {
        // 流中断时把错误作为可见 markdown 内容写入，并正常收尾
        res.write(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  role: 'assistant',
                  content: `\n\n> ⚠️ **智能体响应失败**：${message}\n`,
                },
              },
            ],
          })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }
  }
}
