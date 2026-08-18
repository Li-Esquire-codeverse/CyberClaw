import { RobotOutlined, UserOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { Bubble, Conversations, Sender, Think, XProvider } from '@ant-design/x';
import type {
  BubbleItemType,
  BubbleListProps,
} from '@ant-design/x/es/bubble/interface';
import XMarkdown from '@ant-design/x-markdown';
import { useXChat } from '@ant-design/x-sdk';
import { Avatar, Button, Card, Empty, Select, Space, Tag, Tooltip } from 'antd';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { CyberClawConfig } from '@/services/cyberclaw';
import { loadConfig } from '@/services/cyberclaw';
import type { ConversationItem, ParsedMessage, ToolCallInfo } from './data';
import {
  createChatProvider,
  deleteConversation,
  loadConversations,
  loadHistory,
  saveConversation,
} from './service';
import type { ChatAgentMessage } from './service';
import { useStyles } from './style';

const TypewriterTitle: React.FC<{ text: string }> = ({ text }) => {
  const { styles } = useStyles();
  const [index, setIndex] = useState(0);
  const done = index >= text.length;

  useEffect(() => {
    setIndex(0);
    const timer = setInterval(() => {
      setIndex((i) => {
        if (i >= text.length) {
          clearInterval(timer);
          return i;
        }
        return i + 1;
      });
    }, 50);
    return () => clearInterval(timer);
  }, [text]);

  return (
    <>
      {text.slice(0, index)}
      {!done && <span className={styles.cursor}>|</span>}
    </>
  );
};

const parser = (message: ChatAgentMessage): ParsedMessage => {
  const { content, role, tools, thinkContent } = message;
  if (role !== 'assistant') return { role: 'user', content };

  // 方案 A：provider 直接透传的思考内容（reasoning_delta 累积）优先
  // 方案 B：思考写在 content 里的模型（<think> 标签）解析兜底
  let finalThink = thinkContent;
  let finalContent = content;

  if (finalThink === undefined) {
    const trimmed = content.trimStart();

    const fullMatch = trimmed.match(/^<think>([\s\S]*?)<\/think>([\s\S]*)$/);
    if (fullMatch) {
      finalThink = fullMatch[1];
      finalContent = fullMatch[2].trimStart();
    } else {
      const partialMatch = trimmed.match(/^<think>([\s\S]*)$/);
      if (partialMatch) {
        finalThink = partialMatch[1];
        finalContent = '';
      }
    }
  }

  const result: ParsedMessage = { role: 'assistant', content: finalContent };
  if (finalThink) result.thinkContent = finalThink;
  if (tools?.length) result.tools = tools;
  return result;
};

const STREAMING_ACTIVE = { hasNextChunk: true, enableAnimation: true };
const STREAMING_IDLE = { hasNextChunk: false, enableAnimation: true };

/** 工具调用过程展示：执行中 / 成功 / 失败 三种状态 */
const ToolTrace: React.FC<{
  tools: ToolCallInfo[];
  toolNames: Record<string, string>;
}> = ({ tools, toolNames }) => {
  const { styles } = useStyles();
  if (!tools || tools.length === 0) return null;
  return (
    <div className={styles.toolTrace}>
      <Space size={[8, 4]} wrap>
        {tools.map((t) => {
          const label = toolNames[t.tool] ?? t.tool;
          const color =
            t.status === 'running'
              ? 'processing'
              : t.status === 'success'
                ? 'success'
                : 'error';
          const text =
            t.status === 'running'
              ? `🔧 ${label} 执行中…`
              : t.status === 'success'
                ? `🔧 ${label} 完成`
                : `🔧 ${label} 失败`;
          const tip = [
            t.args ? `参数: ${t.args.slice(0, 200)}` : '',
            t.result ? `结果: ${t.result.slice(0, 300)}` : '',
          ]
            .filter(Boolean)
            .join('\n');
          return (
            <Tooltip key={t.id} title={tip || undefined}>
              <Tag color={color}>{text}</Tag>
            </Tooltip>
          );
        })}
      </Space>
    </div>
  );
};

const roleConfig: BubbleListProps['role'] = {
  user: {
    placement: 'end',
    avatar: <Avatar icon={<UserOutlined />} />,
  },
  ai: {
    placement: 'start',
    avatar: (
      <Avatar
        style={{
          background: 'transparent',
          fontSize: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        🤖
      </Avatar>
    ),
    typing: { effect: 'typing', step: 2, interval: 20 },
    contentRender: (
      content: string,
      info: { status?: string; loading?: boolean },
    ) => {
      if (info?.loading || !content) return undefined;
      return (
        <XMarkdown
          streaming={
            info?.status === 'updating' ? STREAMING_ACTIVE : STREAMING_IDLE
          }
        >
          {content}
        </XMarkdown>
      );
    },
  },
};

const ChatbotPage: React.FC = () => {
  const { styles } = useStyles();
  const idCounter = useRef(0);
  const generateId = useCallback(() => `conv-${++idCounter.current}`, []);

  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeKey, setActiveKey] = useState<string>('');
  const [inputValue, setInputValue] = useState('');

  // ================= 智能体选择（读取 CyberClaw 配置） =================
  const [config, setConfig] = useState<CyberClawConfig | undefined>();
  const [configLoading, setConfigLoading] = useState(true);
  useEffect(() => {
    loadConfig()
      .then((cfg) => {
        setConfig(cfg);
        setConfigLoading(false);
      })
      .catch(() => setConfigLoading(false));
  }, []);
  const agents = useMemo(
    () => (config?.agents ?? []).filter((a) => a.enabled),
    [config],
  );
  const toolNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of config?.tools ?? []) map[t.name] = t.label;
    return map;
  }, [config]);

  const [agentId, setAgentId] = useState<string>();
  const currentAgent = useMemo(
    () => agents.find((a) => a.id === agentId),
    [agents, agentId],
  );
  const currentModel = useMemo(
    () => config?.models.find((m) => m.id === currentAgent?.modelId),
    [config, currentAgent],
  );

  // 默认选中第一个可用智能体
  useEffect(() => {
    if (!agentId && agents.length > 0) {
      setAgentId(agents[0].id);
    }
  }, [agents, agentId]);

  // ================= 会话列表（后端持久化，按智能体加载） =================
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    loadConversations(agentId).then((list) => {
      if (cancelled) return;
      if (list.length > 0) {
        const items: ConversationItem[] = list.map((c) => ({
          key: c.id,
          label: c.title || '新对话',
          group: '历史',
          isDraft: false,
        }));
        setConversations(items);
        setActiveKey((prev) => (prev && items.some((i) => i.key === prev) ? prev : items[0].key));
      } else {
        // 无历史会话：新建一个 draft
        const key = generateId();
        setConversations([
          { key, label: '💬 新对话', group: '今天', isDraft: true },
        ]);
        setActiveKey(key);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  // ================= 对话 Provider（按智能体切换） =================
  const provider = useMemo(
    () => (agentId ? (createChatProvider(agentId) as any) : undefined),
    [agentId],
  );
  const { onRequest, abort, isRequesting, parsedMessages, setMessages } = useXChat<
    any,
    ParsedMessage
  >({
    provider,
    conversationKey: activeKey,
    parser,
    // 历史回显：切换会话时从后端加载该线程消息（langgraph checkpointer 持久化）
    defaultMessages: async ({
      conversationKey: key,
    }: { conversationKey?: string }) => {
      if (!agentId || !key) return [];
      const history = await loadHistory(agentId, String(key));
      return history.map((m) => ({
        message: m as ChatAgentMessage,
        status: 'local' as const,
      }));
    },
    requestPlaceholder: { role: 'assistant', content: '' },
  });

  const sendMessage = (content: string) => {
    const text = content.trim();
    if (!text) return;
    if (!agentId) {
      return;
    }
    setInputValue('');
    const isDraft = conversations.find((c) => c.key === activeKey)?.isDraft;
    setConversations((prev) =>
      prev.map((c) =>
        c.key === activeKey && c.isDraft
          ? { ...c, label: text.slice(0, 20), isDraft: false }
          : c,
      ),
    );
    // 首次发言后把会话持久化到后端（标题取首句，后续消息刷新时间）
    if (isDraft && agentId) {
      void saveConversation({
        id: activeKey,
        agentId,
        title: text.slice(0, 20),
      });
    }
    onRequest({
      messages: [{ role: 'user', content: text }],
      // 会话 ID 即 thread_id：同会话连续对话共享记忆
      conversationId: activeKey,
    });
  };

  const newChat = () => {
    const key = generateId();
    setConversations((prev) => [
      { key, label: '新对话', group: '今天', isDraft: true },
      ...prev,
    ]);
    setActiveKey(key);
  };

  const bubbleItems = useMemo<BubbleItemType[]>(
    () =>
      parsedMessages.map((msg) => {
        const parsed = msg.message as ParsedMessage;
        const isAI = parsed.role === 'assistant';
        const thinkContent =
          parsed.role === 'assistant' ? parsed.thinkContent : undefined;
        const tools = parsed.role === 'assistant' ? parsed.tools : undefined;

        const item: BubbleItemType = {
          key: msg.id,
          role: isAI ? 'ai' : 'user',
          content: parsed.content,
          loading: isAI && msg.status === 'loading',
          status: msg.status,
        };

        if (isAI && (thinkContent || tools?.length)) {
          item.header = (
            <>
              {thinkContent ? (
                <Think defaultExpanded>{thinkContent}</Think>
              ) : null}
              {tools?.length ? (
                <ToolTrace tools={tools} toolNames={toolNames} />
              ) : null}
            </>
          );
        }

        return item;
      }),
    [parsedMessages, toolNames],
  );

  const hasMessages = parsedMessages.length > 0;
  const welcomeText = currentAgent
    ? `🤖 你好，我是「${currentAgent.name}」，有什么可以帮你？`
    : '🤖 你好，有什么可以帮你？';

  const agentOptions = agents.map((a) => {
    const model = config?.models.find((m) => m.id === a.modelId);
    return {
      value: a.id,
      label: a.name,
      desc: `${a.description ?? ''}${model ? ` · ${model.name}` : ''}`.trim(),
    };
  });

  return (
    <PageContainer
      ghost
      childrenContentStyle={{
        paddingBlock: 0,
        height: 'calc(100vh - 160px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Card
        variant="borderless"
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        styles={{
          body: {
            flex: 1,
            padding: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <XProvider>
          <div className={styles.layout}>
            <div className={styles.sidebar}>
              <Conversations
                items={conversations}
                activeKey={activeKey}
                onActiveChange={setActiveKey}
                groupable
                menu={(conversation) => ({
                  items: [{ key: 'delete', label: '删除', danger: true }],
                  onClick: ({ key }) => {
                    if (key === 'delete') {
                      const target = conversation.key;
                      // 后端清理会话（列表元数据 + 线程记忆）
                      void deleteConversation(target);
                      setConversations((prev) => {
                        const next = prev.filter((c) => c.key !== target);
                        if (next.length === 0) {
                          const key = generateId();
                          next.push({
                            key,
                            label: '💬 新对话',
                            group: '今天',
                            isDraft: true,
                          });
                          setActiveKey(key);
                        } else if (activeKey === target) {
                          setActiveKey(next[0]?.key ?? '');
                        }
                        return next;
                      });
                      // 若删除的是当前会话，清空前端消息缓存
                      if (activeKey === target) {
                        setMessages([]);
                      }
                    }
                  },
                })}
                creation={{ onClick: newChat, label: '新建对话' }}
              />
            </div>

            <div className={styles.main}>
              {/* 智能体选择栏 */}
              <div className={styles.agentBar}>
                <Space size={12} align="center">
                  <RobotOutlined style={{ fontSize: 18, color: '#1677ff' }} />
                  <Select
                    value={agentId}
                    onChange={setAgentId}
                    loading={configLoading}
                    placeholder="选择智能体"
                    style={{ minWidth: 220 }}
                    options={agentOptions.map((o) => ({
                      value: o.value,
                      label: (
                        <Space direction="vertical" size={0}>
                          <span>{o.label}</span>
                          {o.desc ? (
                            <span style={{ fontSize: 12, opacity: 0.6 }}>
                              {o.desc}
                            </span>
                          ) : null}
                        </Space>
                      ),
                    }))}
                    popupMatchSelectWidth={false}
                  />
                  {currentAgent ? (
                    <span className={styles.agentDesc}>
                      {currentAgent.description || 'AI 智能体'}
                      {currentModel ? ` · ${currentModel.name}` : ''}
                    </span>
                  ) : null}
                </Space>
              </div>

              {!configLoading && agents.length === 0 ? (
                <div className={styles.emptyState}>
                  <Empty
                    description="还没有可用的智能体，请先在「智能体配置」中创建并启用"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  >
                    <Button type="primary" href="/agents-config/agents">
                      去配置智能体
                    </Button>
                  </Empty>
                </div>
              ) : (
                <>
                  {hasMessages && (
                    <div className={styles.messages}>
                      <Bubble.List
                        items={bubbleItems}
                        role={roleConfig}
                        autoScroll
                        styles={{ root: { maxWidth: 940 } }}
                      />
                    </div>
                  )}

                  <div
                    className={
                      hasMessages ? styles.footer : styles.footerCenter
                    }
                  >
                    {!hasMessages && (
                      <div className={styles.welcomeTitle}>
                        <TypewriterTitle text={welcomeText} />
                      </div>
                    )}
                    <Sender
                      value={inputValue}
                      onChange={setInputValue}
                      loading={isRequesting}
                      disabled={!agentId}
                      onSubmit={sendMessage}
                      onCancel={abort}
                      placeholder={
                        agentId
                          ? `向「${currentAgent?.name ?? ''}」提问，按 Enter 发送...`
                          : '请先选择一个智能体'
                      }
                      autoSize={{ minRows: 4, maxRows: 8 }}
                      style={{ maxWidth: 940, width: '100%' }}
                      styles={{ input: { paddingBlock: 0 } }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </XProvider>
      </Card>
    </PageContainer>
  );
};

export default ChatbotPage;
