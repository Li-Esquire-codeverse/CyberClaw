import { SseRenderer } from './feishu.renderer';

describe('SseRenderer', () => {
  it('累积 choices delta.content，flush 返回正文', () => {
    const r = new SseRenderer();
    r.ingest({ choices: [{ delta: { role: 'assistant', content: '你' } }] });
    r.ingest({ choices: [{ delta: { role: 'assistant', content: '好' } }] });
    expect(r.flush()).toBe('你好');
  });

  it('reasoning_delta 被忽略（不刷屏）', () => {
    const r = new SseRenderer();
    const actions = r.ingest({ event: 'reasoning_delta', reasoning: '思考中…' });
    expect(actions).toEqual([]);
    r.ingest({ choices: [{ delta: { role: 'assistant', content: '正文' } }] });
    expect(r.flush()).toBe('正文');
  });

  it('agent_start 不产生动作', () => {
    const r = new SseRenderer();
    expect(
      r.ingest({ event: 'agent_start', agentId: 'ag_1', agentName: '测试' }),
    ).toEqual([]);
  });

  it('tool_start 返回执行中动作', () => {
    const r = new SseRenderer();
    expect(r.ingest({ event: 'tool_start', tool: 'web-search' })).toEqual([
      { kind: 'tool_status', tool: 'web-search' },
    ]);
  });

  it('tool_end 返回带 ok 的动作', () => {
    const r = new SseRenderer();
    expect(
      r.ingest({ event: 'tool_end', tool: 'web-search', ok: true }),
    ).toEqual([{ kind: 'tool_status', tool: 'web-search', ok: true }]);
  });

  it('超长正文完整返回（由发送层分段，不在渲染层截断）', () => {
    const r = new SseRenderer();
    const long = 'x'.repeat(100_500);
    r.ingest({ choices: [{ delta: { role: 'assistant', content: long } }] });
    expect(r.flush()).toBe(long);
  });

  it('无内容 flush 返回 null', () => {
    const r = new SseRenderer();
    r.ingest({ event: 'agent_start', agentId: 'a', agentName: 'b' });
    expect(r.flush()).toBeNull();
  });

  it('[DONE] 字符串不产生累积', () => {
    const r = new SseRenderer();
    r.ingest('[DONE]' as never);
    r.ingest({ choices: [{ delta: { role: 'assistant', content: 'ok' } }] });
    expect(r.flush()).toBe('ok');
  });

  it('done 后不再累积', () => {
    const r = new SseRenderer();
    r.ingest({ choices: [{ delta: { role: 'assistant', content: 'a' } }] });
    r.flush();
    r.ingest({ choices: [{ delta: { role: 'assistant', content: 'b' } }] });
    expect(r.flush()).toBeNull();
  });

  it('content 带空白时 flush trim', () => {
    const r = new SseRenderer();
    r.ingest({ choices: [{ delta: { role: 'assistant', content: '  hi  ' } }] });
    expect(r.flush()).toBe('hi');
  });
});
