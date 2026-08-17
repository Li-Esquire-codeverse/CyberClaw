import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * CyberClaw 配置文件类型（与 apps/api 契约 / webui services/cyberclaw 一致）。
 */

export interface ClawModel {
  id: string;
  provider: string;
  name: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  enabled: boolean;
  isDefault?: boolean;
}

export interface ClawTool {
  name: string;
  label: string;
  description: string;
  builtin?: boolean;
  enabled: boolean;
  icon?: string;
  /** 参数 JSON Schema（可选，用于下发工具声明给 LLM） */
  parameters?: Record<string, unknown>;
}

export interface ClawAgent {
  id: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  modelId?: string;
  tools?: string[];
  enabled: boolean;
  createdAt?: string;
}

export interface ClawConfigFile {
  agents: ClawAgent[];
  models: ClawModel[];
  tools: ClawTool[];
}

/** 创建 agent 所需的运行时配置：仅含启用项 */
export interface AgentRuntimeConfig {
  models: ClawModel[];
  tools: ClawTool[];
}

export interface LoadConfigOptions {
  /** 显式指定配置文件路径（优先级最高） */
  configFile?: string;
  /** 从该目录向上查找仓库根（默认 process.cwd()） */
  cwd?: string;
}

const CONFIG_FILENAME = 'CyberClaw.json';

/**
 * 定位仓库根：从 cwd 向上逐级查找包含 workspaces 的 package.json，
 * 取第一个命中的目录（与 apps/api config-path.ts 逻辑一致）。
 * 找不到返回 undefined。
 */
export function findRepoRoot(cwd = process.cwd()): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
          workspaces?: unknown;
        };
        if (Array.isArray(pkg.workspaces)) return dir;
      } catch {
        // package.json 损坏则跳过继续向上
      }

    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * 解析配置文件路径，优先级：
 * 1. options.configFile 显式指定
 * 2. 环境变量 CYBERCLAW_CONFIG_FILE
 * 3. 仓库根下的 CyberClaw.json（找不到根则回退 cwd）
 */
export function resolveConfigPath(options: LoadConfigOptions = {}): string {
  const explicit = options.configFile ?? process.env.CYBERCLAW_CONFIG_FILE;
  if (explicit) return resolve(explicit);
  const root = findRepoRoot(options.cwd);
  return join(root ?? resolve(options.cwd ?? process.cwd()), CONFIG_FILENAME);
}

/**
 * 读取 CyberClaw 配置文件（模型 / 工具 / 智能体）。
 * 文件不存在时返回空配置（不抛错）；存在但解析失败抛错。
 */
export function loadConfig(options: LoadConfigOptions = {}): ClawConfigFile {
  const path = resolveConfigPath(options);
  if (!existsSync(path)) {
    return { agents: [], models: [], tools: [] };
  }
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ClawConfigFile>;
  return {
    agents: Array.isArray(raw.agents) ? raw.agents : [],
    models: Array.isArray(raw.models) ? raw.models : [],
    tools: Array.isArray(raw.tools) ? raw.tools : [],
  };
}

/** 启用中的模型列表 */
export function getEnabledModels(config: ClawConfigFile): ClawModel[] {

  return config.models.filter((m) => m.enabled);
}

/** 启用中的工具列表 */
export function getEnabledTools(config: ClawConfigFile): ClawTool[] {
  return config.tools.filter((t) => t.enabled);
}

/**
 * 封装方法：一键读取配置中的模型与工具（仅启用项），
 * 供创建 agent 直接使用。
 */
export function loadAgentRuntimeConfig(
  options: LoadConfigOptions = {},
): AgentRuntimeConfig {
  const config = loadConfig(options);
  return {
    models: getEnabledModels(config),
    tools: getEnabledTools(config),
  };
}
