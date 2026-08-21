import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));

vi.mock('@umijs/max', () => ({
  request: mockRequest,
}));

import {
  createChatProvider,
  deleteConversation,
  loadConversations,
  loadHistory,
  saveConversation,
  type ChatAgentMessage,
} from './service';

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

describe('conversations API', () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it('loadConversations 带 agentId 过滤参数', async () => {
    mockRequest.mockResolvedValue([{ id: 'c1', agentId: 'ag_1', title: 'x' }]);
    const list = await loadConversations('ag_1');
    expect(mockRequest).toHaveBeenCalledWith('/api/claw/conversations?agentId=ag_1', {
      method: 'GET',
      skipErrorHandler: true,
    });
    expect(list).toHaveLength(1);
  });

  it('loadConversations 失败时返回空列表', async () => {
    mockRequest.mockRejectedValue(new Error('network'));
    expect(await loadConversations('ag_1')).toEqual([]);
  });

  it('saveConversation POST 到后端', async () => {
    mockRequest.mockResolvedValue({ id: 'c1', agentId: 'ag_1', title: '新对话' });
    await saveConversation({ id: 'c1', agentId: 'ag_1', title: '新对话' });
    expect(mockRequest).toHaveBeenCalledWith('/api/claw/conversations', {
      method: 'POST',
      data: { id: 'c1', agentId: 'ag_1', title: '新对话' },
      skipErrorHandler: true,
    });
  });

  it('deleteConversation DELETE 单资源', async () => {
    mockRequest.mockResolvedValue({ ok: true });
    expect(await deleteConversation('c1')).toBe(true);
    expect(mockRequest).toHaveBeenCalledWith('/api/claw/conversations/c1', {
      method: 'DELETE',
      skipErrorHandler: true,
    });
  });

  it('loadHistory 读取会话线程消息', async () => {
    mockRequest.mockResolvedValue([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello', thinkContent: '想一下' },
    ]);
    const history = await loadHistory('ag_1', 'conv-1');
    expect(mockRequest).toHaveBeenCalledWith(
      '/api/claw/chat/history?agentId=ag_1&conversationId=conv-1',
      { method: 'GET', skipErrorHandler: true },
    );
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ thinkContent: '想一下' });
  });

  it('loadHistory 失败时抛出带后端错误信息的异常（不静默）', async () => {
    mockRequest.mockRejectedValue({
      response: { data: { message: '智能体「法律文书智能体」关联的大模型未启用' } },
    });
    await expect(loadHistory('ag_1', 'conv-1')).rejects.toThrow(
      '智能体「法律文书智能体」关联的大模型未启用',
    );
  });

  it('loadHistory 失败且无后端信息时抛出通用错误', async () => {
    mockRequest.mockRejectedValue(new Error('Network Error'));
    await expect(loadHistory('ag_1', 'conv-1')).rejects.toThrow('Network Error');
  });
});

describe('CyberClawChatProvider.transformParams', () => {
  it('只传本轮新消息 + conversationId（历史由后端 checkpointer 恢复）', () => {
    const provider = createChatProvider('ag_1') as unknown as {
      transformParams: (p: object, o: object) => object;
    };
    const result = provider.transformParams(
      {
        messages: [{ role: 'user', content: 'hi' }],
        conversationId: 'conv-1',
      },
      { params: { agentId: 'ag_1', stream: true } },
    ) as { agentId: string; stream: boolean; conversationId: string; messages: unknown[] };

    expect(result).toEqual({
      agentId: 'ag_1',
      stream: true,
      conversationId: 'conv-1',
      messages: [{ role: 'user', content: 'hi' }],
    });
  });

  it('缺省 conversationId 时请求体不携带该字段（后端按 agentId 兜底）', () => {
    const provider = createChatProvider('ag_1') as unknown as {
      transformParams: (p: object, o: object) => object;
    };
    const result = provider.transformParams(
      { messages: [{ role: 'user', content: 'hi' }] },
      { params: { agentId: 'ag_1', stream: true } },
    ) as { conversationId?: string; messages: unknown[] };

    expect(result.conversationId).toBeUndefined();
    expect(result.messages).toHaveLength(1);
  });
});

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
