import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoadConfig, mockSaveConfig, mockUpdateModelApi, mockDeleteModelApi } =
  vi.hoisted(() => ({
    mockLoadConfig: vi.fn(),
    mockSaveConfig: vi.fn(),
    mockUpdateModelApi: vi.fn(),
    mockDeleteModelApi: vi.fn(),
  }));

vi.mock('@/services/cyberclaw', () => ({
  defaultConfig: () => ({ agents: [], models: [], tools: [] }),
  loadConfig: mockLoadConfig,
  saveConfig: mockSaveConfig,
  updateModelApi: mockUpdateModelApi,
  deleteModelApi: mockDeleteModelApi,
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

import ModelsPage from './Models';

const baseConfig = {
  agents: [],
  models: [
    {
      id: 'mdl_1',
      provider: 'deepseek',
      name: '生产 DeepSeek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-old',
      enabled: true,
      isDefault: true,
    },
  ],
  tools: [],
};

/** 编辑 Modal 与添加表单的 label 同名，需限定在 dialog 内查询 */
async function openEditDialog() {
  fireEvent.click(await screen.findByRole('button', { name: '编辑 生产 DeepSeek' }));
  return await screen.findByRole('dialog');
}

describe('ModelsPage 编辑功能', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(baseConfig);
    mockSaveConfig.mockResolvedValue({ ok: true, remote: true });
  });

  it('渲染模型列表', async () => {
    render(<ModelsPage />);
    expect(await screen.findByText('生产 DeepSeek')).toBeInTheDocument();
  });

  it('点击编辑按钮打开 Modal 并预填当前值', async () => {
    render(<ModelsPage />);
    const dialog = await openEditDialog();

    await waitFor(() => {
      expect(within(dialog).getByLabelText('配置名称')).toHaveValue('生产 DeepSeek');
    });
    expect(within(dialog).getByLabelText('Base URL')).toHaveValue(
      'https://api.deepseek.com/v1',
    );
    expect(within(dialog).getByLabelText('API Key')).toHaveValue('sk-old');
    expect(within(dialog).getByLabelText('模型名称')).toHaveValue('deepseek-chat');
  });

  it('修改 API Key 提交后调用 updateModelApi 并刷新配置', async () => {
    mockUpdateModelApi.mockResolvedValue({
      ok: true,
      data: { ...baseConfig.models[0], apiKey: 'sk-new' },
    });
    const fresh = {
      ...baseConfig,
      models: [{ ...baseConfig.models[0], apiKey: 'sk-new' }],
    };
    mockLoadConfig
      .mockResolvedValueOnce(baseConfig)
      .mockResolvedValueOnce(fresh);

    render(<ModelsPage />);
    const dialog = await openEditDialog();

    const apiKeyInput = await within(dialog).findByLabelText('API Key');
    fireEvent.change(apiKeyInput, { target: { value: 'sk-new' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => {
      expect(mockUpdateModelApi).toHaveBeenCalledWith(
        'mdl_1',
        expect.objectContaining({ apiKey: 'sk-new' }),
      );
    });
    await waitFor(() => {
      expect(mockLoadConfig).toHaveBeenCalledTimes(2);
    });
  });

  it('后端拒绝时透出错误且 Modal 不关闭', async () => {
    mockUpdateModelApi.mockResolvedValue({ ok: false, error: '模型「重名模型」已存在' });
    mockLoadConfig.mockResolvedValueOnce(baseConfig);

    const { message } = await import('antd');

    render(<ModelsPage />);
    const dialog = await openEditDialog();

    const nameInput = await within(dialog).findByLabelText('配置名称');
    fireEvent.change(nameInput, { target: { value: '重名模型' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => {
      expect(message.error).toHaveBeenCalledWith('模型「重名模型」已存在');
    });
    expect(within(screen.getByRole('dialog')).getByLabelText('配置名称')).toBeInTheDocument();
    expect(mockLoadConfig).toHaveBeenCalledTimes(1);
  });
});

describe('ModelsPage 创建流程（按钮展开）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(baseConfig);
    mockSaveConfig.mockResolvedValue({ ok: true, remote: true });
  });

  it('进入页面时不显示创建表单，点击新增按钮后展开', async () => {
    render(<ModelsPage />);
    await screen.findByText('生产 DeepSeek');
    expect(screen.queryByLabelText('配置名称')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /保存/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /新增模型/ }));
    expect(await screen.findByLabelText('配置名称')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /保存/ })).toBeInTheDocument();
  });

  it('必填项缺失时保存被表单校验拦截', async () => {
    render(<ModelsPage />);
    fireEvent.click(screen.getByRole('button', { name: /新增模型/ }));
    // 只填名称，不填必填的 Base URL
    const nameInput = await screen.findByLabelText('配置名称');
    fireEvent.change(nameInput, { target: { value: '校验测试' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));

    await waitFor(() => {
      expect(screen.getByText('请输入接口地址')).toBeInTheDocument();
    });
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('填写完整信息保存后调用 saveConfig 并收起表单', async () => {
    render(<ModelsPage />);
    fireEvent.click(screen.getByRole('button', { name: /新增模型/ }));

    fireEvent.change(await screen.findByLabelText('配置名称'), {
      target: { value: '测试模型' },
    });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.test.com/v1' },
    });
    fireEvent.change(screen.getByLabelText('模型名称'), {
      target: { value: 'test-chat' },
    });

    fireEvent.click(screen.getByRole('button', { name: /保存/ }));

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          models: expect.arrayContaining([
            expect.objectContaining({
              name: '测试模型',
              baseUrl: 'https://api.test.com/v1',
              model: 'test-chat',
            }),
          ]),
        }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByLabelText('配置名称')).not.toBeInTheDocument();
    });
  });

  it('点击取消收起表单', async () => {
    render(<ModelsPage />);
    fireEvent.click(screen.getByRole('button', { name: /新增模型/ }));
    await screen.findByLabelText('配置名称');
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));

    await waitFor(() => {
      expect(screen.queryByLabelText('配置名称')).not.toBeInTheDocument();
    });
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });
});
