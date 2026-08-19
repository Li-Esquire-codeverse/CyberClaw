import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockLoadConversations: vi.fn(),
  mockLoadHistory: vi.fn(),
  mockSaveConversation: vi.fn(),
  mockDeleteConversation: vi.fn(),
  mockUseXChat: vi.fn(),
  mockModalConfirm: vi.fn(),
}));

vi.mock('@/services/cyberclaw', () => ({
  loadConfig: mocks.mockLoadConfig,
}));

vi.mock('@ant-design/pro-components', () => ({
  PageContainer: ({ children, extra }: any) => (
    <div>
      {extra}
      {children}
    </div>
  ),
}));

vi.mock('@ant-design/x-sdk', () => ({
  useXChat: mocks.mockUseXChat,
}));

vi.mock('@ant-design/x-markdown', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('./service', () => ({
  createChatProvider: () => ({}),
  loadConversations: mocks.mockLoadConversations,
  loadHistory: mocks.mockLoadHistory,
  saveConversation: mocks.mockSaveConversation,
  deleteConversation: mocks.mockDeleteConversation,
}));

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    message: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
    },
    Modal: Object.assign(actual.Modal, {
      // Modal.confirm 在 jsdom 下渲染到独立 root 且关闭动画永不完成会残留，
      // 这里 mock 掉：组件逻辑（传入的 config + onOk 行为）可确定性验证
      confirm: mocks.mockModalConfirm,
    }),
  };
});

import ChatbotPage from './index';

const baseConfig = {
  agents: [
    {
      id: 'ag_1',
      name: '法律文书智能体',
      description: '测试智能体',
      systemPrompt: '你是测试助手',
      modelId: 'mdl_1',
      tools: [],
      enabled: true,
      createdAt: '2026-08-18T00:00:00.000Z',
    },
    {
      id: 'ag_2',
      name: '代码助手',
      description: '第二个智能体',
      systemPrompt: '你是代码助手',
      modelId: 'mdl_1',
      tools: [],
      enabled: true,
      createdAt: '2026-08-18T00:00:00.000Z',
    },
  ],
  models: [
    {
      id: 'mdl_1',
      provider: 'deepseek',
      name: 'DeepSeek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      enabled: true,
      isDefault: true,
    },
  ],
  tools: [],
};

const historyConversations = [
  {
    id: 'c1',
    agentId: 'ag_1',
    title: '旧标题',
    createdAt: '2026-08-18T10:00:00.000Z',
    updatedAt: '2026-08-18T11:00:00.000Z',
  },
];

function mockXChatDefault() {
  mocks.mockUseXChat.mockReturnValue({
    onRequest: vi.fn(),
    abort: vi.fn(),
    isRequesting: false,
    parsedMessages: [],
    setMessages: vi.fn(),
  });
}

/** 点击会话条目的「…」打开操作菜单，再点菜单项 */
async function openMenuAndClick(menuLabel: string, index = 0) {
  const icons = document.querySelectorAll('.ant-conversations-menu-icon');
  expect(icons.length).toBeGreaterThan(index);
  fireEvent.click(icons[index]);
  fireEvent.click(await screen.findByText(menuLabel));
}

/** 触发上一次 Modal.confirm 的 onOk（等价于用户点击确认按钮） */
async function confirmOk() {
  expect(mocks.mockModalConfirm).toHaveBeenCalled();
  const config = mocks.mockModalConfirm.mock.calls.at(-1)![0];
  await act(async () => {
    await config.onOk?.();
  });
}

/** 读取最后一次 Modal.confirm 的配置（校验确认框内容） */
function lastConfirmConfig() {
  return mocks.mockModalConfirm.mock.calls.at(-1)![0];
}

describe('ChatbotPage 会话管理', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockLoadConfig.mockResolvedValue(baseConfig);
    mocks.mockLoadConversations.mockResolvedValue(historyConversations);
    mocks.mockLoadHistory.mockResolvedValue([]);
    mockXChatDefault();
  });

  it('加载后展示历史会话列表', async () => {
    render(<ChatbotPage />);
    expect(await screen.findByText('旧标题')).toBeInTheDocument();
    expect(mocks.mockLoadConversations).toHaveBeenCalledWith('ag_1');
  });

  it('重命名：菜单打开 Modal 预填标题，保存后调用 saveConversation 并更新标签', async () => {
    mocks.mockSaveConversation.mockResolvedValue({
      id: 'c1',
      agentId: 'ag_1',
      title: '新标题',
    });
    render(<ChatbotPage />);
    await screen.findByText('旧标题');

    await openMenuAndClick('重命名');

    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByPlaceholderText('输入会话名称');
    expect(input).toHaveValue('旧标题');

    fireEvent.change(input, { target: { value: '新标题' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(mocks.mockSaveConversation).toHaveBeenCalledWith({
        id: 'c1',
        agentId: 'ag_1',
        title: '新标题',
      });
    });
    expect(await screen.findByText('新标题')).toBeInTheDocument();
    expect(screen.queryByText('旧标题')).not.toBeInTheDocument();
  });

  it('重命名为空时提示且不调用接口', async () => {
    render(<ChatbotPage />);
    await screen.findByText('旧标题');

    await openMenuAndClick('重命名');
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByPlaceholderText('输入会话名称');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(mocks.mockSaveConversation).not.toHaveBeenCalled();
    });
  });

  it('删除：弹出二次确认，确认后调用 deleteConversation 并移除会话', async () => {
    mocks.mockDeleteConversation.mockResolvedValue(true);
    render(<ChatbotPage />);
    await screen.findByText('旧标题');

    await openMenuAndClick('删除');

    // Modal.confirm 收到正确的标题与内容（含会话名）
    const config = lastConfirmConfig();
    expect(config.title).toBe('删除会话');
    expect(config.content).toContain('确定删除「旧标题」');

    await confirmOk();

    await waitFor(() => {
      expect(mocks.mockDeleteConversation).toHaveBeenCalledWith('c1');
    });
    await waitFor(() => {
      expect(screen.queryByText('旧标题')).not.toBeInTheDocument();
    });
    // 删空后自动落到新建的草稿会话
    expect(screen.getByText('💬 新对话')).toBeInTheDocument();
  });

  it('完整链路：重命名 B + 删除 A + 新建对话，B 仍在列表中', async () => {
    // 模拟用户报告的场景：两个会话，重命名其中一个，删除另一个，再新建
    mocks.mockLoadConversations.mockResolvedValue([
      { id: 'conv-A', agentId: 'ag_1', title: '我是谁？', createdAt: '2026-08-18T10:00:00.000Z', updatedAt: '2026-08-18T12:00:00.000Z' },
      { id: 'conv-B', agentId: 'ag_1', title: '你是谁？', createdAt: '2026-08-18T10:30:00.000Z', updatedAt: '2026-08-18T11:00:00.000Z' },
    ]);
    mocks.mockSaveConversation.mockResolvedValue({
      id: 'conv-B',
      agentId: 'ag_1',
      title: '自我介绍',
    });
    mocks.mockDeleteConversation.mockResolvedValue(true);

    render(<ChatbotPage />);
    await screen.findByText('我是谁？');

    // 1) 重命名 conv-B → 自我介绍（列表按后端顺序，第一个是 conv-A）
    await openMenuAndClick('重命名', 1);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('输入会话名称'), {
      target: { value: '自我介绍' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /保\s*存/ }));
    expect(await screen.findByText('自我介绍')).toBeInTheDocument();

    // 2) 删除 conv-A（我是谁？）
    // 重命名用的下拉菜单关闭动画在 jsdom 下永不完成、portal 残留（含 重命名/删除 两项），
    // 打开 A 的菜单后总菜单项为 4，最后一个是 A 的
    const iconsAfter = document.querySelectorAll('.ant-conversations-menu-icon');
    fireEvent.click(iconsAfter[0]);
    await waitFor(() => {
      expect(document.querySelectorAll('.ant-dropdown-menu-item')).toHaveLength(4);
    });
    const deleteItems = screen.getAllByText('删除');
    fireEvent.click(deleteItems[deleteItems.length - 1]);

    expect(lastConfirmConfig().content).toContain('确定删除「我是谁？」');
    await confirmOk();

    await waitFor(() => {
      expect(mocks.mockDeleteConversation).toHaveBeenCalledWith('conv-A');
    });
    await waitFor(() => {
      expect(screen.queryByText('我是谁？')).not.toBeInTheDocument();
    });

    // 3) 新建对话
    fireEvent.click(await screen.findByText('新建对话'));

    // 重命名的 conv-B 必须仍在列表中
    expect(screen.getByText('自我介绍')).toBeInTheDocument();
    expect(screen.getByText('新对话')).toBeInTheDocument();
  });

  it('切换智能体后列表按新智能体加载，切回后旧会话仍在', async () => {
    const agentList = [
      { id: 'conv-A', agentId: 'ag_1', title: '法律会话', createdAt: 'x', updatedAt: 'x' },
    ];
    mocks.mockLoadConversations.mockImplementation((agentId?: string) => {
      if (agentId === 'ag_2') return Promise.resolve([]);
      return Promise.resolve(agentList);
    });
    render(<ChatbotPage />);
    await screen.findByText('法律会话');

    // 切换到 ag_2（代码助手）→ 无历史 → 新建草稿
    const select = screen.getByRole('combobox');
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByText('代码助手'));
    await waitFor(() => {
      expect(screen.getByText('💬 新对话')).toBeInTheDocument();
    });
    expect(screen.queryByText('法律会话')).not.toBeInTheDocument();

    // 切回 ag_1 → 会话仍在
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByText('法律文书智能体'));
    expect(await screen.findByText('法律会话')).toBeInTheDocument();
  });

  it('删除失败时保留会话并提示', async () => {
    mocks.mockDeleteConversation.mockResolvedValue(false);
    render(<ChatbotPage />);
    await screen.findByText('旧标题');

    await openMenuAndClick('删除');
    await confirmOk();

    await waitFor(() => {
      expect(mocks.mockDeleteConversation).toHaveBeenCalledWith('c1');
    });
    expect(await screen.findByText('旧标题')).toBeInTheDocument();
  });
});
