// @ts-ignore
/* eslint-disable */
import { request } from '@umijs/max';

/**
 * CyberClaw 配置服务
 *
 * 所有配置最终通过接口保存到后端 `.imooc_claw/imooc_claw.json` 文件：
 *   GET  /api/claw/config  ->  读取配置
 *   POST /api/claw/config  ->  保存配置
 *
 * 后端项目尚未创建，因此这里做了 localStorage 兜底：
 *  - 读取：优先请求后端，失败则回退本地缓存
 *  - 保存：同时写入本地缓存；后端不可用时仅保存在本地并标记 remote=false
 */

const LOCAL_CONFIG_KEY = 'cyberclaw.config';

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

/** 整体配置结构（对应 imooc_claw.json） */
export interface CyberClawConfig {
  agents: ClawAgent[];
  models: ClawModel[];
  tools: ClawTool[];
}

/** 内置工具清单 */
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

/** 默认配置 */
export function defaultConfig(): CyberClawConfig {
  return {
    agents: [],
    models: [],
    tools: BUILTIN_TOOLS,
  };
}

/** 读取配置（优先后端，失败回退本地） */
export async function loadConfig(): Promise<CyberClawConfig> {
  try {
    const res = await request<CyberClawConfig>('/api/claw/config', {
      method: 'GET',
      skipErrorHandler: true,
    });
    if (res && Array.isArray(res.tools)) {
      localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(res));
      return res;
    }
  } catch (e) {
    // 后端未就绪，回退本地
  }
  const local = localStorage.getItem(LOCAL_CONFIG_KEY);
  if (local) {
    try {
      return JSON.parse(local);
    } catch (e) {
      /* ignore */
    }
  }
  return defaultConfig();
}

/** 保存配置（写入后端 + 本地兜底） */
export async function saveConfig(
  config: CyberClawConfig,
): Promise<{ ok: boolean; remote: boolean }> {
  localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(config));
  try {
    await request('/api/claw/config', {
      method: 'POST',
      data: config,
      skipErrorHandler: true,
    });
    return { ok: true, remote: true };
  } catch (e) {
    // 后端未就绪：已保存在本地
    return { ok: true, remote: false };
  }
}
