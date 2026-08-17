import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoadConfig, mockSaveConfig, mockUpdateAgentApi } = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockUpdateAgentApi: vi.fn(),
}));

vi.mock('@/services/cyberclaw', () => ({
  defaultConfig: () => ({ agents: [], models: [], tools: [] }),
  loadConfig: mockLoadConfig,
  saveConfig: mockSaveConfig,
  updateAgentApi: mockUpdateAgentApi,
}));

vi.mock('@ant-design/pro-components', () => ({
  PageContainer: ({ children, extra }: any) => (
    <div>
      {extra}
      {children}
    </div>
  ),
  ProCard: ({ children, title }: any) => (
    <div>
      <div>{title}</div>
      {children}
    </div>
  ),
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
  };
});

import AgentsPage from './Agents';

const baseConfig = {
  agents: [
    {
      id: 'ag_1',
      name: '法律助手',
      description: '处理法律文书',
      systemPrompt: '你是法律助手',
      modelId: 'mdl_1',
      tools: ['web-search'],
      enabled: true,
      createdAt: '2026-08-09T08:39:30.948Z',
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
  tools: [
    {
      name: 'web-search',
      label: '网页搜索',
      description: '搜索',
      builtin: true,
      enabled: true,
    },
  ],
};

/** 编辑 Modal 与创建表单的 label 同名，需限定在 dialog 内查询 */
async function openEditDialog() {
  fireEvent.click(await screen.findByRole('button', { name: '编辑 法律助手' }));
  return await screen.findByRole('dialog');
}

describe('AgentsPage 编辑功能', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(baseConfig);
    mockSaveConfig.mockResolvedValue({ ok: true, remote: true });
  });

  it('渲染智能体列表', async () => {
    render(<AgentsPage />);
    expect(await screen.findByText('法律助手')).toBeInTheDocument();
    expect(mockLoadConfig).toHaveBeenCalled();
  });

  it('点击编辑按钮打开 Modal 并预填当前值', async () => {
    render(<AgentsPage />);
    const dialog = await openEditDialog();

    await waitFor(() => {
      expect(within(dialog).getByLabelText('智能体名称')).toHaveValue('法律助手');
    });
    expect(within(dialog).getByLabelText('描述')).toHaveValue('处理法律文书');
    expect(within(dialog).getByLabelText('系统提示词（System Prompt）')).toHaveValue(
      '你是法律助手',
    );
  });

  it('修改名称提交后调用 updateAgentApi 并刷新配置', async () => {
    mockUpdateAgentApi.mockResolvedValue({
      ok: true,
      data: { ...baseConfig.agents[0], name: '新名字' },
    });
    const fresh = { ...baseConfig, agents: [{ ...baseConfig.agents[0], name: '新名字' }] };
    mockLoadConfig
      .mockResolvedValueOnce(baseConfig)
      .mockResolvedValueOnce(fresh);

    render(<AgentsPage />);
    const dialog = await openEditDialog();

    const nameInput = await within(dialog).findByLabelText('智能体名称');
    fireEvent.change(nameInput, { target: { value: '新名字' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => {
      expect(mockUpdateAgentApi).toHaveBeenCalledWith(
        'ag_1',
        expect.objectContaining({ name: '新名字' }),
      );
    });
    // 更新成功走单资源接口后重新拉取后端配置
    await waitFor(() => {
      expect(mockLoadConfig).toHaveBeenCalledTimes(2);
    });
    // Modal 关闭（destroyOnHidden 卸载内容）
    await waitFor(() => {
      expect(screen.queryByDisplayValue('新名字')).not.toBeInTheDocument();
    });
  });

  it('后端拒绝（重名 409）时透出错误且 Modal 不关闭', async () => {
    mockUpdateAgentApi.mockResolvedValue({ ok: false, error: '智能体「新名字」已存在' });
    mockLoadConfig.mockResolvedValueOnce(baseConfig);

    const { message } = await import('antd');

    render(<AgentsPage />);
    const dialog = await openEditDialog();

    const nameInput = await within(dialog).findByLabelText('智能体名称');
    fireEvent.change(nameInput, { target: { value: '新名字' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => {
      expect(message.error).toHaveBeenCalledWith('智能体「新名字」已存在');
    });
    // Modal 仍打开
    expect(within(screen.getByRole('dialog')).getByLabelText('智能体名称')).toBeInTheDocument();
    // 失败不应触发刷新
    expect(mockLoadConfig).toHaveBeenCalledTimes(1);
  });
});

describe('AgentsPage 创建流程（按钮展开）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(baseConfig);
    mockSaveConfig.mockResolvedValue({ ok: true, remote: true });
  });

  it('进入页面时不显示创建表单，点击新增按钮后展开', async () => {
    render(<AgentsPage />);
    await screen.findByText('法律助手');
    // 默认不渲染创建表单
    expect(screen.queryByLabelText('智能体名称')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /保存/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /新增智能体/ }));
    expect(await screen.findByLabelText('智能体名称')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /保存/ })).toBeInTheDocument();
  });

  it('必填项缺失时保存被表单校验拦截', async () => {
    render(<AgentsPage />);
    fireEvent.click(screen.getByRole('button', { name: /新增智能体/ }));
    const nameInput = await screen.findByLabelText('智能体名称');
    fireEvent.change(nameInput, { target: { value: '校验测试' } });
    // 不选择必填的关联大模型直接保存
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));

    await waitFor(() => {
      expect(screen.getByText('请选择关联大模型')).toBeInTheDocument();
    });
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('填写完整信息保存后调用 saveConfig 并收起表单', async () => {
    render(<AgentsPage />);
    fireEvent.click(screen.getByRole('button', { name: /新增智能体/ }));

    const nameInput = await screen.findByLabelText('智能体名称');
    fireEvent.change(nameInput, { target: { value: '新智能体' } });

    // 选择关联大模型
    fireEvent.mouseDown(screen.getByLabelText('关联大模型'));
    fireEvent.click(await screen.findByText('DeepSeek (deepseek)'));

    fireEvent.click(screen.getByRole('button', { name: /保存/ }));

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          agents: expect.arrayContaining([
            expect.objectContaining({ name: '新智能体', modelId: 'mdl_1' }),
          ]),
        }),
      );
    });
    // 保存成功后表单收起
    await waitFor(() => {
      expect(screen.queryByLabelText('智能体名称')).not.toBeInTheDocument();
    });
  });

  it('点击取消收起表单并清空输入', async () => {
    render(<AgentsPage />);
    fireEvent.click(screen.getByRole('button', { name: /新增智能体/ }));
    const nameInput = await screen.findByLabelText('智能体名称');
    fireEvent.change(nameInput, { target: { value: '临时内容' } });
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));

    await waitFor(() => {
      expect(screen.queryByLabelText('智能体名称')).not.toBeInTheDocument();
    });
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });
});
