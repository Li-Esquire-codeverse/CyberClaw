import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatService, ChatSseEvent } from '../chat/chat.service';
import { ConversationsStore } from '../chat/conversations.store';
import type { ChatMessageDto } from '../chat/chat.dto';
import { CompactStore } from './compact.store';
import {
  COMPACT_KEEP_RECENT,
  COMPACT_MAX_CHARS,
  COMPACT_MAX_MESSAGES,
  COMPACT_SECONDARY_MAX,
  maybeCompact,
  shouldCompact,
  summarizeHistory,
} from './compact';

const chatServiceMock = {
  streamChat: jest.fn(),
  resolveAgentIdOrThrow: jest.fn(),
} as unknown as ChatService;

const builtAgentMock = {} as never;

async function* streamOf(events: ChatSseEvent[]): AsyncGenerator<ChatSseEvent> {
  for (const e of events) yield e;
}

function historyOf(n: number, text = '消息内容'): ChatMessageDto[] {
  return Array.from({ length: n }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `${text} ${i}`,
  }));
}

describe('shouldCompact（压缩判定）', () => {
  afterEach(() => delete process.env.COMPACTION);

  it('30 条以内不触发（边界）', () => {
    expect(shouldCompact(historyOf(COMPACT_MAX_MESSAGES))).toBe(false);
  });

  it('超过 30 条触发', () => {
    expect(shouldCompact(historyOf(COMPACT_MAX_MESSAGES + 1))).toBe(true);
  });

  it('累计字符超过 20_000 触发', () => {
    const msgs = [1, 2].map(() => ({
      role: 'user' as const,
      content: '长'.repeat(COMPACT_MAX_CHARS),
    }));
    expect(shouldCompact(msgs)).toBe(true);
  });

  it('字符恰好等于阈值不触发（边界）', () => {
    expect(shouldCompact([{ role: 'user', content: '长'.repeat(COMPACT_MAX_CHARS) }])).toBe(false);
  });

  it('COMPACTION=0 关闭压缩', () => {
    process.env.COMPACTION = '0';
    expect(shouldCompact(historyOf(100))).toBe(false);
  });
});

describe('summarizeHistory（摘要生成）', () => {
  it('非流式聚合 content delta 生成摘要，kept 保留最近 10 条', async () => {
    const history = historyOf(40);
    (chatServiceMock.streamChat as jest.Mock).mockReturnValue(
      streamOf([
        { event: 'agent_start', agentId: 'ag_1', agentName: '测试' },
        { event: 'reasoning_delta', reasoning: '思考' },
        { choices: [{ delta: { role: 'assistant', content: '用户关注' } }] },
        { choices: [{ delta: { role: 'assistant', content: '法律条款' } }] },
        '[DONE]',
      ]),
    );

    const result = await summarizeHistory({
      history,
      agent: builtAgentMock,
      chatService: chatServiceMock,
    });

    expect(result.summary).toBe('用户关注法律条款');
    expect(result.kept).toHaveLength(COMPACT_KEEP_RECENT);
    // 摘要 prompt 作为 user 消息交给 streamChat
    const callArgs = (chatServiceMock.streamChat as jest.Mock).mock.calls[0];
    expect(callArgs[1][0].content).toContain('请用 200 字以内总结');
    expect(callArgs[1][0].content).toContain('user: 消息内容 0');
  });
});

describe('maybeCompact（压缩入口 + 复用逻辑）', () => {
  let dir: string;
  let conversations: ConversationsStore;
  let store: CompactStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cyberclaw-compact-'));
    conversations = new ConversationsStore(join(dir, 'test.db'));
    store = new CompactStore(conversations);
    jest.clearAllMocks();
  });

  afterEach(() => {
    conversations.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('未超阈值：原样返回，不生成不写库', async () => {
    const history = historyOf(5);
    const result = await maybeCompact({
      history,
      agent: builtAgentMock,
      chatService: chatServiceMock,
      conversationId: 'c1',
      store,
    });
    expect(result).toEqual({ summary: undefined, kept: history, recomputed: false });
    expect(chatServiceMock.streamChat).not.toHaveBeenCalled();
    expect(store.loadSummary('c1')).toBeUndefined();
  });

  it('超阈值且无摘要：生成一次并写入库（recomputed=true）', async () => {
    (chatServiceMock.streamChat as jest.Mock).mockReturnValue(
      streamOf([
        { choices: [{ delta: { role: 'assistant', content: '摘要正文' } }] },
        '[DONE]',
      ]),
    );
    const history = historyOf(40);
    const result = await maybeCompact({
      history,
      agent: builtAgentMock,
      chatService: chatServiceMock,
      conversationId: 'c1',
      store,
    });
    expect(result.recomputed).toBe(true);
    expect(result.summary).toBe('摘要正文');
    expect(result.kept).toHaveLength(COMPACT_KEEP_RECENT);
    expect(store.loadSummary('c1')).toBe('摘要正文');
  });

  it('重复请求（已有摘要且未到二级阈值）：复用库中摘要，零重算', async () => {
    store.saveSummary('c1', '旧摘要');
    (chatServiceMock.streamChat as jest.Mock).mockReturnValue(
      streamOf([{ choices: [{ delta: { role: 'assistant', content: '不应被调用' } }] }, '[DONE]']),
    );
    const history = historyOf(40);
    const result = await maybeCompact({
      history,
      agent: builtAgentMock,
      chatService: chatServiceMock,
      conversationId: 'c1',
      store,
    });
    expect(result).toMatchObject({ summary: '旧摘要', recomputed: false });
    expect(result.kept).toHaveLength(COMPACT_KEEP_RECENT);
    expect(chatServiceMock.streamChat).not.toHaveBeenCalled();
  });

  it('消息超过二级阈值（>60）：即使有摘要也强制重算', async () => {
    store.saveSummary('c1', '旧摘要');
    (chatServiceMock.streamChat as jest.Mock).mockReturnValue(
      streamOf([
        { choices: [{ delta: { role: 'assistant', content: '新摘要' } }] },
        '[DONE]',
      ]),
    );
    const history = historyOf(COMPACT_SECONDARY_MAX + 1);
    const result = await maybeCompact({
      history,
      agent: builtAgentMock,
      chatService: chatServiceMock,
      conversationId: 'c1',
      store,
    });
    expect(result.recomputed).toBe(true);
    expect(result.summary).toBe('新摘要');
    expect(store.loadSummary('c1')).toBe('新摘要');
  });
});

describe('CompactStore（摘要持久化）', () => {
  let dir: string;
  let conversations: ConversationsStore;
  let store: CompactStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cyberclaw-compact-store-'));
    conversations = new ConversationsStore(join(dir, 'test.db'));
    store = new CompactStore(conversations);
  });

  afterEach(() => {
    conversations.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('saveSummary/loadSummary 往返一致', () => {
    store.saveSummary('c1', '摘要A');
    expect(store.loadSummary('c1')).toBe('摘要A');
    store.saveSummary('c1', '摘要B');
    expect(store.loadSummary('c1')).toBe('摘要B');
  });

  it('无记录返回 undefined', () => {
    expect(store.loadSummary('nope')).toBeUndefined();
  });
});
