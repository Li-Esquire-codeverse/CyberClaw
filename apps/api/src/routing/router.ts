import { ClawAgent } from '../claw/claw.types';

/** resolveAgentId 入参 */
export interface ResolveAgentIdInput {
  /** 用户消息文本 */
  message: string;
  /** 全部智能体（按配置顺序） */
  agents: ClawAgent[];
  /** 显式默认智能体（等价 FEISHU_AGENT_ID），仅作关键词无命中时的回退 */
  defaultAgentId?: string;
}

/**
 * 路由选择器（纯函数）：消息文本 → agentId。
 *
 * 优先级（对齐 Phase 4 A4 验收："有关键词时按路由分发；无关键词时行为与现在完全一致"）：
 *   1. 关键词路由：按配置顺序遍历（enabled 且 keywords 非空），
 *      消息包含任一关键词（大小写不敏感）即命中，返回该 agent.id
 *   2. 回退：defaultAgentId 显式指定且该 agent enabled → 用它
 *   3. 回退：第一个 enabled agent（Phase 3 行为，向后兼容）
 *   4. 全部停用 / 为空 → undefined（由调用方提示"没有可用智能体"）
 *
 * 永不抛错（ADR-2：路由失败不是用户错误）。
 */
export function resolveAgentId(input: ResolveAgentIdInput): string | undefined {
  const { message, agents, defaultAgentId } = input;

  // 1. 关键词路由
  const lowered = message.toLowerCase();
  for (const agent of agents) {
    if (!agent.enabled) continue;
    const keywords = agent.keywords?.filter((k) => k.trim().length > 0) ?? [];
    if (keywords.length === 0) continue;
    if (keywords.some((k) => lowered.includes(k.toLowerCase()))) {
      return agent.id;
    }
  }

  // 2. 显式默认智能体回退
  if (defaultAgentId) {
    const def = agents.find((a) => a.id === defaultAgentId && a.enabled);
    if (def) return def.id;
  }

  // 3. 第一个启用的智能体回退
  const firstEnabled = agents.find((a) => a.enabled);
  if (firstEnabled) return firstEnabled.id;

  // 4. 无可路由目标
  return undefined;
}
