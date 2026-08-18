import { describe, expect, it } from 'vitest';
import { createChatProvider, type ChatAgentMessage } from './service';

type TransformInfo = {
  originMessage?: ChatAgentMessage;
  chunk: { data?: string };
};

/** 构造 transformMessage 调用参数 */
function info(data: string, origin?: ChatAgentMessage): TransformInfo {
  return {
    originMessage: origin ?? { role: 'assistant', content: '' },
    chunk: { data },
  };
}

function sse(payload: unknown): string {
  return JSON.stringify(payload);
}

describe('CyberClawChatProvider.transformMessage', () => {
  const provider = createChatProvider('ag_1') as unknown as {
    transformMessage: (i: TransformInfo) => ChatAgentMessage;
  };

  it('累积 reasoning_delta 片段到 thinkContent', () => {
    const first = provider.transformMessage(
      info(sse({ event: 'reasoning_delta', reasoning: '用户问的是算术题，' })),
    );
    expect(first.thinkContent).toBe('用户问的是算术题，');

    const second = provider.transformMessage(
      info(
        sse({ event: 'reasoning_delta', reasoning: '我需要计算 1+2' }),
        first,
      ),
    );
    expect(second.thinkContent).toBe('用户问的是算术题，我需要计算 1+2');
    expect(second.content).toBe('');
  });

  it('choices.delta.content 累积正文（打字机效果）', () => {
    const first = provider.transformMessage(
      info(
        sse({ choices: [{ delta: { role: 'assistant', content: '结果' } }] }),
      ),
    );
    const second = provider.transformMessage(
      info(
        sse({ choices: [{ delta: { role: 'assistant', content: '是 3' } }] }),
        first,
      ),
    );
    expect(second.content).toBe('结果是 3');
  });

  it('思考先于正文到达，两者互不覆盖', () => {
    const thinking = provider.transformMessage(
      info(sse({ event: 'reasoning_delta', reasoning: '先想一下' })),
    );
    const final = provider.transformMessage(
      info(
        sse({ choices: [{ delta: { role: 'assistant', content: '答案来了' } }] }),
        thinking,
      ),
    );
    expect(final.thinkContent).toBe('先想一下');
    expect(final.content).toBe('答案来了');
  });

  it('tool_start / tool_end 完整记录工具调用过程', () => {
    const started = provider.transformMessage(
      info(
        sse({
          event: 'tool_start',
          tool: 'web-search',
          args: '{"q":"天气"}',
        }),
      ),
    );
    expect(started.tools).toHaveLength(1);
    expect(started.tools![0]).toMatchObject({
      tool: 'web-search',
      status: 'running',
    });

    const done = provider.transformMessage(
      info(
        sse({ event: 'tool_end', tool: 'web-search', ok: true, result: '晴' }),
        started,
      ),
    );
    expect(done.tools).toHaveLength(1);
    expect(done.tools![0]).toMatchObject({
      tool: 'web-search',
      status: 'success',
      result: '晴',
    });
  });

  it('tool_end ok:false 标记为 error', () => {
    const started = provider.transformMessage(
      info(sse({ event: 'tool_start', tool: 'browser' })),
    );
    const done = provider.transformMessage(
      info(
        sse({ event: 'tool_end', tool: 'browser', ok: false, result: '超时' }),
        started,
      ),
    );
    expect(done.tools![0].status).toBe('error');
    expect(done.tools![0].result).toBe('超时');
  });

  it('同一工具多次调用各自独立记录', () => {
    const first = provider.transformMessage(
      info(sse({ event: 'tool_start', tool: 'web-search', args: '{"q":"a"}' })),
    );
    const second = provider.transformMessage(
      info(sse({ event: 'tool_start', tool: 'web-search', args: '{"q":"b"}' }), first),
    );
    expect(second.tools).toHaveLength(2);
    expect(second.tools![1].args).toBe('{"q":"b"}');
  });

  it('完整链路：思考 → 工具 → 正文混合流', () => {
    const t1 = provider.transformMessage(
      info(sse({ event: 'reasoning_delta', reasoning: '需要搜索' })),
    );
    const t2 = provider.transformMessage(
      info(sse({ event: 'tool_start', tool: 'web-search', args: '{}' }), t1),
    );
    const t3 = provider.transformMessage(
      info(sse({ event: 'tool_end', tool: 'web-search', ok: true, result: '数据' }), t2),
    );
    const t4 = provider.transformMessage(
      info(sse({ choices: [{ delta: { role: 'assistant', content: '根据搜索' } }] }), t3),
    );

    expect(t4.thinkContent).toBe('需要搜索');
    expect(t4.tools![0].status).toBe('success');
    expect(t4.content).toBe('根据搜索');
  });
});
