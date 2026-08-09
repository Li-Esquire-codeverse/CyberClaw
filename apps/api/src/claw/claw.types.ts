/**
 * CyberClaw 配置类型定义
 *
 * 与前端 apps/webui/src/services/cyberclaw/index.ts 的契约保持一致。
 * 所有配置持久化在仓库根目录的 CyberClaw.json 中，agents 配置维护在 `agents` key 下。
 */

/** 智能体配置 */
export interface ClawAgent {
  id: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  /** 关联的大模型 id */
  modelId?: string;
  /** 启用的工具名列表 */
  tools: string[];
  enabled: boolean;
  createdAt?: string;
}

/** 大模型配置 */
export interface ClawModel {
  id: string;
  provider: string;
  /** 配置名称（用户起的别名） */
  name: string;
  /** 实际模型名称，如 deepseek-chat */
  model: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  isDefault?: boolean;
}

/** 工具配置 */
export interface ClawTool {
  name: string;
  label: string;
  description: string;
  builtin: boolean;
  enabled: boolean;
  icon?: string;
}

/** 整体配置结构（对应 CyberClaw.json） */
export interface CyberClawConfig {
  agents: ClawAgent[];
  models: ClawModel[];
  tools: ClawTool[];
}

/** 内置工具清单（与前端 BUILTIN_TOOLS 一致） */
export const BUILTIN_TOOLS: ClawTool[] = [
  {
    name: 'web-search',
    label: '网页搜索',
    description: '通过搜索引擎检索互联网信息，用于回答时效性问题。',
    builtin: true,
    enabled: true,
    icon: 'search',
  },
  {
    name: 'browser',
    label: '浏览器控制',
    description: '控制无头浏览器访问网页、抓取内容、模拟用户操作。',
    builtin: true,
    enabled: true,
    icon: 'chrome',
  },
  {
    name: 'file-ops',
    label: '文件操作',
    description: '读写、创建、移动、删除本地文件与目录。',
    builtin: true,
    enabled: true,
    icon: 'folder',
  },
  {
    name: 'shell',
    label: '命令执行',
    description: '在本地执行 shell 命令，自动化完成系统级任务。',
    builtin: true,
    enabled: false,
    icon: 'console-sql',
  },
  {
    name: 'memory',
    label: '记忆管理',
    description: '长期记忆的写入、检索与管理，跨会话保持上下文。',
    builtin: true,
    enabled: true,
    icon: 'database',
  },
  {
    name: 'code-interpreter',
    label: '代码解释器',
    description: '在沙箱中运行 Python / JS 代码片段并返回执行结果。',
    builtin: true,
    enabled: true,
    icon: 'code',
  },
  {
    name: 'image-gen',
    label: '图片生成',
    description: '根据文本描述生成图片（接入文生图模型）。',
    builtin: true,
    enabled: false,
    icon: 'picture',
  },
  {
    name: 'translate',
    label: '翻译',
    description: '多语言互译，支持自动检测源语言。',
    builtin: true,
    enabled: true,
    icon: 'translation',
  },
];

/** 默认配置（深拷贝内置工具，避免污染模块级 BUILTIN_TOOLS） */
export function defaultConfig(): CyberClawConfig {
  return {
    agents: [],
    models: [],
    tools: BUILTIN_TOOLS.map((t) => ({ ...t })),
  };
}

/** 归一化配置：补全缺失的 key，容忍手改文件时结构不完整 */
export function normalizeConfig(raw: Partial<CyberClawConfig> | null | undefined): CyberClawConfig {
  const base = defaultConfig();
  return {
    agents: Array.isArray(raw?.agents) ? raw!.agents : base.agents,
    models: Array.isArray(raw?.models) ? raw!.models : base.models,
    tools: Array.isArray(raw?.tools) && raw!.tools.length > 0 ? raw!.tools : base.tools,
  };
}
