import {
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  NotFoundException,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ChatService, type BuiltAgent } from '../chat/chat.service';
import type { ChatMessageDto } from '../chat/chat.dto';
import { ClawConfigService } from '../claw/claw-config.service';
import {
  createTranslateContext,
  sanitizeOpenAiMessages,
  toOpenAiError,
  translateSseEvent,
} from './openai.translate';
import type {
  OpenAiChatMessage,
  OpenAiChatRequest,
  OpenAiModelInfo,
} from './openai.types';

/**
 * OpenAI 兼容端点（spec 阶段 B / ADR-3）：
 *   GET  /v1/models
 *   POST /v1/chat/completions（stream 可选）
 *
 * 复用既有 ChatService 的 buildAgent + streamChat（记忆/工具/多 agent 路由
 * 自动生效，P3 协议翻译复用链路），协议差异全部收敛在 openai.translate.ts
 * 纯函数中。错误统一返回 OpenAI 风格 { error: { message, type, code } }。
 */
@Controller('v1')
export class OpenAiController {
  private readonly logger = new Logger(OpenAiController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly configService: ClawConfigService,
  ) {}

  /** GET /v1/models：列出启用的智能体（model 参数语义是 agent 引用，见 §4.4.2） */
  @Get('models')
  listModels(): OpenAiModelInfo[] {
    return this.configService
      .listAgents()
      .filter((a) => a.enabled)
      .map((a) => ({
        id: a.id,
        object: 'model',
        created: a.createdAt
          ? Math.floor(new Date(a.createdAt).getTime() / 1000)
          : 0,
        owned_by: 'cyberclaw',
      }));
  }

  /**
   * POST /v1/chat/completions：
   *   1. 校验 messages（缺省 400，统一 OpenAI 风格错误）
   *   2. model 解析 → agentId（agent:<id> / 名称 / id / 缺省走路由）
   *   3. buildAgent + streamChat
   *   4. stream=false → 聚合完整 choices；stream=true → OpenAI SSE 行
   */
  @Post('chat/completions')
  async chatCompletions(
    @Body() body: OpenAiChatRequest,
    @Res() res: Response,
  ): Promise<void> {
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      res.status(400).json({
        error: {
          message: 'messages is required and must be a non-empty array',
          type: 'invalid_request_error',
          code: '400',
        },
      });
      return;
    }

    let messages: ChatMessageDto[];
    try {
      messages = sanitizeOpenAiMessages(body.messages);
    } catch (err) {
      this.sendError(res, err);
      return;
    }
    if (messages.length === 0) {
      res.status(400).json({
        error: {
          message: 'messages contains no user/assistant messages',
          type: 'invalid_request_error',
          code: '400',
        },
      });
      return;
    }

    let agentId: string;
    try {
      agentId = this.resolveModelAgent(body.model, body.messages);
    } catch (err) {
      this.sendError(res, err);
      return;
    }

    let built: BuiltAgent;
    try {
      built = await this.chatService.buildAgent(agentId);
    } catch (err) {
      this.sendError(res, err);
      return;
    }

    const abortController = new AbortController();
    res.on('close', () => abortController.abort());

    if (body.stream === true) {
      await this.handleStream(res, built, messages, abortController);
    } else {
      await this.handleNonStream(
        res,
        built,
        messages,
        abortController,
        body.model ?? agentId,
      );
    }
  }

  /**
   * model 参数解析（三者都支持，spec §4.4.2）：
   *   - "agent:<agentId>"：显式指定
   *   - agent 名称 / agent id：按名称、ID 匹配
   *   - 缺省：走多 agent 路由（按消息关键词分发，A3 复用）
   */
  private resolveModelAgent(
    model: string | undefined,
    messages: OpenAiChatMessage[],
  ): string {
    const lastUser =
      [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    if (!model || !model.trim()) {
      return this.chatService.resolveAgentIdOrThrow(lastUser);
    }
    const m = model.trim();
    if (m.startsWith('agent:')) {
      return m.slice('agent:'.length);
    }
    const agents = this.configService.listAgents();
    const byName = agents.find((a) => a.name === m);
    if (byName) return byName.id;
    const byId = agents.find((a) => a.id === m);
    if (byId) return byId.id;
    throw new NotFoundException(`未知的模型或智能体: ${m}`);
  }

  /** stream=true：SSE 流式（chat.completion.chunk 行格式，以 data: [DONE] 收尾） */
  private async handleStream(
    res: Response,
    built: BuiltAgent,
    messages: ChatMessageDto[],
    abortController: AbortController,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const ctx = createTranslateContext();
    try {
      for await (const evt of this.chatService.streamChat(
        built,
        messages,
        abortController.signal,
      )) {
        if (res.destroyed || res.writableEnded) return;
        if (evt === '[DONE]') break;
        const line = translateSseEvent(evt, ctx);
        if (line) {
          res.write(`data: ${JSON.stringify(line)}\n\n`);
        }
      }
      if (!res.destroyed && !res.writableEnded) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
    } catch (err) {
      this.logger.error(
        `OpenAI stream failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (!res.destroyed && !res.writableEnded) {
        // 流中断：输出 OpenAI 错误行后正常收尾
        res.write(`data: ${JSON.stringify(toOpenAiError(err))}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }
  }

  /** stream=false：聚合全部事件 → 完整 chat.completion 对象 */
  private async handleNonStream(
    res: Response,
    built: BuiltAgent,
    messages: ChatMessageDto[],
    abortController: AbortController,
    model: string,
  ): Promise<void> {
    const ctx = createTranslateContext();
    let content = '';
    const toolCalls: Array<{
      id?: string;
      type: 'function';
      function: { name?: string; arguments: string };
    }> = [];
    try {
      for await (const evt of this.chatService.streamChat(
        built,
        messages,
        abortController.signal,
      )) {
        if (evt === '[DONE]') break;
        const line = translateSseEvent(evt, ctx);
        if (!line || !('choices' in line)) continue;
        const delta = line.choices[0]?.delta;
        if (delta?.content) content += delta.content;
        for (const tc of delta?.tool_calls ?? []) {
          let agg = toolCalls[tc.index];
          if (!agg) {
            agg = { type: 'function', function: { arguments: '' } };
            toolCalls[tc.index] = agg;
          }
          if (tc.id) agg.id = tc.id;
          if (tc.function?.name) agg.function.name = tc.function.name;
          if (tc.function?.arguments) {
            agg.function.arguments += tc.function.arguments;
          }
        }
      }
    } catch (err) {
      this.sendError(res, err);
      return;
    }

    const message: Record<string, unknown> = { role: 'assistant', content };
    if (toolCalls.length > 0) message.tool_calls = toolCalls;

    res.json({
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        { index: 0, message, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }

  /** 统一 OpenAI 风格错误输出（流未开始时用 JSON 状态码，流中时用错误行收尾） */
  private sendError(res: Response, err: unknown): void {
    const status = err instanceof HttpException ? err.getStatus() : 500;
    if (!res.headersSent) {
      res.status(status).json(toOpenAiError(err));
    } else if (!res.destroyed && !res.writableEnded) {
      res.write(`data: ${JSON.stringify(toOpenAiError(err))}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}
