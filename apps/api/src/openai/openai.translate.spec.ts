import { HttpException } from '@nestjs/common';
import {
  createTranslateContext,
  sanitizeOpenAiMessages,
  toOpenAiError,
  translateSseEvent,
} from './openai.translate';

describe('translateSseEvent（SSE → OpenAI SSE 纯函数）', () => {
  it('agent_start → 无输出（仅记录）', () => {
    const ctx = createTranslateContext();
    expect(
      translateSseEvent(
        { event: 'agent_start', agentId: 'ag_1', agentName: '测试助手' },
        ctx,
      ),
    ).toBeNull();
    // 未产生任何输出：started 仍为 false
    expect(ctx.started).toBe(false);
  });

  it('reasoning_delta → 忽略（OpenAI 协议无思考字段）', () => {
    const ctx = createTranslateContext();
    expect(translateSseEvent({ event: 'reasoning_delta', reasoning: '思考中' }, ctx)).toBeNull();
    expect(ctx.started).toBe(false);
  });

  it('choices content → delta.content，首行补 role: assistant', () => {
    const ctx = createTranslateContext();
    const first = translateSseEvent(
      { choices: [{ delta: { role: 'assistant', content: '你' } }] },
      ctx,
    );
    expect(first).toEqual({
      choices: [{ index: 0, delta: { role: 'assistant', content: '你' } }],
    });
    // 后续行不再重复 role
    const second = translateSseEvent(
      { choices: [{ delta: { role: 'assistant', content: '好' } }] },
      ctx,
    );
    expect(second).toEqual({
      choices: [{ index: 0, delta: { content: '好' } }],
    });
  });

  it('空 content 增量 → 无输出', () => {
    const ctx = createTranslateContext();
    expect(
      translateSseEvent({ choices: [{ delta: { role: 'assistant', content: '' } }] }, ctx),
    ).toBeNull();
  });

  it('tool_start → 新增 tool_calls 增量（id/name/arguments，index 递增）', () => {
    const ctx = createTranslateContext();
    const first = translateSseEvent(
      { event: 'tool_start', tool: 'web-search', args: '{"qu' },
      ctx,
    );
    expect(first).toEqual({
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'call_0',
                type: 'function',
                function: { name: 'web-search', arguments: '{"qu' },
              },
            ],
          },
        },
      ],
    });
    // 第二个工具调用 index 递增
    const second = translateSseEvent(
      { event: 'tool_start', tool: 'translate', args: '' },
      ctx,
    );
    const toolCalls = (second as { choices: Array<{ delta: { tool_calls: Array<{ index: number }> } }> })
      .choices[0].delta.tool_calls;
    expect(toolCalls[0].index).toBe(1);
  });

  it('tool_end → 只发剩余 arguments 增量（tool_start 前缀 + 剩余 = 完整参数）', () => {
    const ctx = createTranslateContext();
    translateSseEvent({ event: 'tool_start', tool: 'web-search', args: '{"q' }, ctx);
    const end = translateSseEvent(
      { event: 'tool_end', tool: 'web-search', ok: true, args: '{"query":"机票"}' },
      ctx,
    );
    expect(end).toEqual({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { arguments: 'uery":"机票"}' } }],
          },
        },
      ],
    });
  });

  it('tool_start 无参数时 tool_end 完整发出', () => {
    const ctx = createTranslateContext();
    translateSseEvent({ event: 'tool_start', tool: 'translate', args: '' }, ctx);
    const end = translateSseEvent(
      { event: 'tool_end', tool: 'translate', ok: true, args: '{"text":"你好"}' },
      ctx,
    );
    const args = (end as { choices: Array<{ delta: { tool_calls: Array<{ function: { arguments: string } }> } }> })
      .choices[0].delta.tool_calls[0].function.arguments;
    expect(args).toBe('{"text":"你好"}');
  });

  it('DONE → null（调用方自行输出 data: [DONE]）', () => {
    const ctx = createTranslateContext();
    expect(translateSseEvent('[DONE]', ctx)).toBeNull();
  });

  it('未知扩展事件 → 忽略', () => {
    const ctx = createTranslateContext();
    expect(
      translateSseEvent(
        { event: 'weird_event', message: 'x' } as never,
        ctx,
      ),
    ).toBeNull();
  });
});

describe('toOpenAiError（错误对象格式）', () => {
  it('HttpException → OpenAI 风格 + 状态码映射 type/code', () => {
    const err = new HttpException('智能体不存在: ag_x', 404);
    expect(toOpenAiError(err)).toEqual({
      error: {
        message: '智能体不存在: ag_x',
        type: 'invalid_request_error',
        code: '404',
      },
    });
  });

  it('普通 Error → server_error/500', () => {
    expect(toOpenAiError(new Error('boom'))).toEqual({
      error: { message: 'boom', type: 'server_error', code: '500' },
    });
  });

  it('非 Error 值 → 字符串化 message', () => {
    expect(toOpenAiError('plain string')).toEqual({
      error: { message: 'plain string', type: 'server_error', code: '500' },
    });
  });

  it('带 message 字段的响应对象 → 取 message', () => {
    const err = new HttpException({ message: '缺少参数' }, 400);
    expect(toOpenAiError(err).error.message).toBe('缺少参数');
  });
});

describe('sanitizeOpenAiMessages（消息预处理）', () => {
  it('保留 user/assistant，丢弃 system/tool', () => {
    const out = sanitizeOpenAiMessages([
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '嗨' },
      { role: 'tool', content: '{"ok":true}' },
    ]);
    expect(out).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '嗨' },
    ]);
  });

  it('非字符串 content（多模态数组）转字符串', () => {
    const out = sanitizeOpenAiMessages([
      { role: 'user', content: 'x' },
      { role: 'user', content: [{ type: 'text', text: 'hi' }] as never },
    ]);
    expect(out[1].content).toBe('[{"type":"text","text":"hi"}]');
  });

  it('未知 role → 400', () => {
    expect(() =>
      sanitizeOpenAiMessages([{ role: 'function', content: 'x' }]),
    ).toThrow(HttpException);
  });
});
