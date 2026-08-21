// @ts-ignore
/* eslint-disable */
import { request } from '@umijs/max';

/**
 * CyberClaw 配置服务
 *
 * 所有配置最终通过接口保存到后端仓库根目录 `CyberClaw.json`：
 *   GET  /api/claw/config  ->  读取配置
 *   POST /api/claw/config  ->  保存配置
 *
 * 后端不可用时做了 localStorage 兜底：
 *  - 读取：优先请求后端，失败则回退本地缓存
 *  - 保存：同时写入本地缓存；后端不可用时仅保存在本地并标记 remote=false
 *  - 后端校验拒绝（4xx，如被引用/必填）时会透出具体错误信息
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
  /** 参数 JSON Schema（下发工具声明给 LLM） */
  parameters?: Record<string, unknown>;
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
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询关键词，可包含多个关键词以空格分隔' },
        numResults: { type: 'integer', description: '返回结果条数（1-10，默认 5）' },
      },
      required: ['query'],
    },
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
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['read', 'write', 'list', 'mkdir', 'move', 'delete', 'stat'],
          description: '要执行的操作',
        },
        path: { type: 'string', description: '目标文件/目录路径（相对工作区根，禁止 .. 越界）' },
        content: { type: 'string', description: '写入内容（write 时必填）' },
        target: { type: 'string', description: '目标路径（move 时必填）' },
        recursive: {
          type: 'boolean',
          description: '是否递归（delete 删目录 / mkdir 嵌套 / list 列子树时用）',
        },
      },
      required: ['operation', 'path'],
    },
  },
  {
    name: 'shell',
    label: '命令执行',
    description: '在本地执行 shell 命令，自动化完成系统级任务。',
    builtin: true,
    enabled: false,
    icon: 'console-sql',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
        timeoutSec: { type: 'integer', description: '超时秒数（默认 30，最大 120）' },
        cwd: { type: 'string', description: '工作目录（相对工作区根，默认工作区根）' },
      },
      required: ['command'],
    },
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
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要翻译的原文' },
        targetLang: { type: 'string', description: '目标语言代码，如 zh-CN / en / ja / ko / fr / de（默认 zh-CN）' },
        sourceLang: { type: 'string', description: '源语言代码，auto 表示自动检测（默认 auto）' },
      },
      required: ['text'],
    },
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

/** 保存配置（写入后端 + 本地兜底；后端拒绝时返回 error） */
export async function saveConfig(
  config: CyberClawConfig,
): Promise<{ ok: boolean; remote: boolean; error?: string }> {
  localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(config));
  try {
    await request('/api/claw/config', {
      method: 'POST',
      data: config,
      skipErrorHandler: true,
    });
    return { ok: true, remote: true };
  } catch (e: unknown) {
    const err = e as { data?: { message?: string | string[] }; response?: { data?: { message?: string | string[] } } };
    const msg = err?.data?.message ?? err?.response?.data?.message;
    const text = Array.isArray(msg) ? msg.join('；') : msg;
    if (typeof text === 'string' && text.length > 0) {
      // 后端明确拒绝了本次保存（如引用校验失败）
      return { ok: false, remote: false, error: text };
    }
    // 网络/连接问题：已保存在本地兜底
    return { ok: true, remote: false };
  }
}

/** 提取后端错误信息（优先 data.message，兼容数组） */
function extractErrorMessage(e: unknown): string | undefined {
  const err = e as {
    data?: { message?: string | string[] };
    response?: { data?: { message?: string | string[] } };
  };
  const msg = err?.data?.message ?? err?.response?.data?.message;
  const text = Array.isArray(msg) ? msg.join('；') : msg;
  return typeof text === 'string' && text.length > 0 ? text : undefined;
}

/**
 * 删除模型（走单资源接口，联动校验失败时返回 409 友好提示）
 * 被智能体引用时后端会拒绝删除，返回 ok:false + error 说明
 */
export async function deleteModelApi(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await request(`/api/claw/models/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      skipErrorHandler: true,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: extractErrorMessage(e) ?? '删除失败' };
  }
}

/**
 * 更新智能体（走单资源接口 PUT，只传需要修改的字段）
 * 后端会做重名（409）与 modelId/tools 引用（422）校验，错误原样透出
 */
export async function updateAgentApi(
  id: string,
  patch: Partial<
    Pick<ClawAgent, 'name' | 'description' | 'systemPrompt' | 'modelId' | 'tools' | 'enabled'>
  >,
): Promise<{ ok: boolean; data?: ClawAgent; error?: string }> {
  try {
    const data = await request<ClawAgent>(`/api/claw/agents/${encodeURIComponent(id)}`, {
      method: 'PUT',
      data: patch,
      skipErrorHandler: true,
    });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: extractErrorMessage(e) ?? '更新失败' };
  }
}

/**
 * 更新模型（走单资源接口 PUT，只传需要修改的字段）
 * 后端会做重名（409）校验；设为默认时自动清除其他模型的默认标记
 */
export async function updateModelApi(
  id: string,
  patch: Partial<
    Pick<ClawModel, 'name' | 'provider' | 'model' | 'baseUrl' | 'apiKey' | 'enabled' | 'isDefault'>
  >,
): Promise<{ ok: boolean; data?: ClawModel; error?: string }> {
  try {
    const data = await request<ClawModel>(`/api/claw/models/${encodeURIComponent(id)}`, {
      method: 'PUT',
      data: patch,
      skipErrorHandler: true,
    });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: extractErrorMessage(e) ?? '更新失败' };
  }
}
