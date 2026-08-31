import { resolveAgentId } from './router';
import { ClawAgent } from '../claw/claw.types';

function agent(partial: Partial<ClawAgent> & { id: string; name: string }): ClawAgent {
  return {
    tools: [],
    enabled: true,
    ...partial,
  };
}

describe('resolveAgentId（路由选择器）', () => {
  // ==================== 关键词命中 ====================

  it('命中关键词返回对应 agent', () => {
    const agents = [
      agent({ id: 'ag_law', name: '法律文书', keywords: ['合同', '律师', '起诉'] }),
      agent({ id: 'ag_trans', name: '翻译助手', keywords: ['翻译', 'translate'] }),
    ];
    expect(resolveAgentId({ message: '帮我写份合同', agents })).toBe('ag_law');
    expect(resolveAgentId({ message: '把这段话翻译成英文', agents })).toBe('ag_trans');
  });

  it('大小写不敏感', () => {
    const agents = [
      agent({ id: 'ag_trans', name: '翻译助手', keywords: ['Translate', 'TRANSLATION'] }),
    ];
    expect(resolveAgentId({ message: 'please translate this', agents })).toBe('ag_trans');
    expect(resolveAgentId({ message: '帮我做个 Translation', agents })).toBe('ag_trans');
  });

  it('多 agent 按配置顺序优先（先到先得）', () => {
    const agents = [
      agent({ id: 'ag_a', name: 'A', keywords: ['合同'] }),
      agent({ id: 'ag_b', name: 'B', keywords: ['合同'] }),
    ];
    expect(resolveAgentId({ message: '看下合同', agents })).toBe('ag_a');
  });

  it('停用的 agent 不参与关键词路由', () => {
    const agents = [
      agent({ id: 'ag_law', name: '法律文书', enabled: false, keywords: ['合同'] }),
      agent({ id: 'ag_general', name: '通用助手' }),
    ];
    expect(resolveAgentId({ message: '帮我写份合同', agents })).toBe('ag_general');
  });

  it('未配置 keywords 的 agent 不参与路由（即使它在前面）', () => {
    const agents = [
      agent({ id: 'ag_general', name: '通用助手' }),
      agent({ id: 'ag_law', name: '法律文书', keywords: ['合同'] }),
    ];
    expect(resolveAgentId({ message: '帮我写份合同', agents })).toBe('ag_law');
  });

  it('空白关键词被忽略', () => {
    const agents = [
      agent({ id: 'ag_a', name: 'A', keywords: ['   ', ''] }),
      agent({ id: 'ag_b', name: 'B', keywords: ['合同'] }),
    ];
    expect(resolveAgentId({ message: '看下合同', agents })).toBe('ag_b');
  });

  // ==================== 回退 ====================

  it('无命中回退第一个启用的 agent', () => {
    const agents = [
      agent({ id: 'ag_law', name: '法律文书', keywords: ['合同'] }),
      agent({ id: 'ag_general', name: '通用助手' }),
    ];
    expect(resolveAgentId({ message: '今天天气怎么样', agents })).toBe('ag_law');
  });

  it('指定 defaultAgentId 时，无命中回退到它（而非第一个启用）', () => {
    const agents = [
      agent({ id: 'ag_law', name: '法律文书', keywords: ['合同'] }),
      agent({ id: 'ag_default', name: '默认助手' }),
    ];
    expect(
      resolveAgentId({ message: '今天天气怎么样', agents, defaultAgentId: 'ag_default' }),
    ).toBe('ag_default');
  });

  it('defaultAgentId 指定的 agent 停用时回退第一个启用', () => {
    const agents = [
      agent({ id: 'ag_law', name: '法律文书', keywords: ['合同'] }),
      agent({ id: 'ag_disabled', name: '停用', enabled: false }),
    ];
    expect(
      resolveAgentId({ message: '今天天气怎么样', agents, defaultAgentId: 'ag_disabled' }),
    ).toBe('ag_law');
  });

  it('关键词命中优先于 defaultAgentId（Phase 4 核心价值：自动分流）', () => {
    const agents = [
      agent({ id: 'ag_law', name: '法律文书', keywords: ['合同'] }),
      agent({ id: 'ag_default', name: '默认助手' }),
    ];
    expect(
      resolveAgentId({ message: '帮我写份合同', agents, defaultAgentId: 'ag_default' }),
    ).toBe('ag_law');
  });

  // ==================== 边界 ====================

  it('全部停用返回 undefined', () => {
    const agents = [
      agent({ id: 'ag_a', name: 'A', enabled: false, keywords: ['合同'] }),
      agent({ id: 'ag_b', name: 'B', enabled: false }),
    ];
    expect(resolveAgentId({ message: '你好', agents })).toBeUndefined();
  });

  it('空 agents 返回 undefined', () => {
    expect(resolveAgentId({ message: '你好', agents: [] })).toBeUndefined();
  });

  it('空消息不崩溃，走回退逻辑', () => {
    const agents = [agent({ id: 'ag_a', name: 'A', keywords: ['合同'] })];
    expect(resolveAgentId({ message: '', agents })).toBe('ag_a');
  });
});
