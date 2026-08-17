import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));

vi.mock('@umijs/max', () => ({
  request: mockRequest,
}));

import {
  deleteModelApi,
  updateAgentApi,
  updateModelApi,
} from './index';

describe('updateAgentApi', () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it('calls PUT /api/claw/agents/:id with the patch', async () => {
    const updated = { id: 'ag_1', name: '新名字', tools: [], enabled: true };
    mockRequest.mockResolvedValue(updated);

    const res = await updateAgentApi('ag_1', { name: '新名字', enabled: true });

    expect(mockRequest).toHaveBeenCalledWith('/api/claw/agents/ag_1', {
      method: 'PUT',
      data: { name: '新名字', enabled: true },
      skipErrorHandler: true,
    });
    expect(res).toEqual({ ok: true, data: updated });
  });

  it('returns ok:false with the backend error message on 409/422', async () => {
    mockRequest.mockRejectedValue({
      data: { message: '智能体「新名字」已存在' },
    });

    const res = await updateAgentApi('ag_1', { name: '新名字' });

    expect(res).toEqual({ ok: false, error: '智能体「新名字」已存在' });
  });

  it('falls back to a generic message when the backend returns none', async () => {
    mockRequest.mockRejectedValue(new Error('network down'));

    const res = await updateAgentApi('ag_1', { name: 'x' });

    expect(res).toEqual({ ok: false, error: '更新失败' });
  });
});

describe('updateModelApi', () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it('calls PUT /api/claw/models/:id with the patch', async () => {
    const updated = {
      id: 'mdl_1',
      provider: 'deepseek',
      name: '生产 DeepSeek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-2',
      enabled: true,
    };
    mockRequest.mockResolvedValue(updated);

    const res = await updateModelApi('mdl_1', { apiKey: 'sk-2', enabled: true });

    expect(mockRequest).toHaveBeenCalledWith('/api/claw/models/mdl_1', {
      method: 'PUT',
      data: { apiKey: 'sk-2', enabled: true },
      skipErrorHandler: true,
    });
    expect(res).toEqual({ ok: true, data: updated });
  });

  it('joins array error messages from the backend', async () => {
    mockRequest.mockRejectedValue({
      data: { message: ['配置名称不能为空', '请输入模型名称'] },
    });

    const res = await updateModelApi('mdl_1', { name: '' });

    expect(res).toEqual({ ok: false, error: '配置名称不能为空；请输入模型名称' });
  });
});

describe('deleteModelApi (regression)', () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it('calls DELETE /api/claw/models/:id', async () => {
    mockRequest.mockResolvedValue({ ok: true });

    const res = await deleteModelApi('mdl_1');

    expect(mockRequest).toHaveBeenCalledWith('/api/claw/models/mdl_1', {
      method: 'DELETE',
      skipErrorHandler: true,
    });
    expect(res).toEqual({ ok: true });
  });

  it('returns ok:false with 409 reference error', async () => {
    mockRequest.mockRejectedValue({
      data: { message: '模型「X」正被 2 个智能体使用' },
    });

    const res = await deleteModelApi('mdl_1');

    expect(res).toEqual({ ok: false, error: '模型「X」正被 2 个智能体使用' });
  });
});
