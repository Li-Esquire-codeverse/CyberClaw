import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { resolveConfigFilePath } from './config-path';
import {
  ClawAgent,
  ClawModel,
  ClawTool,
  CyberClawConfig,
  defaultConfig,
  normalizeConfig,
} from './claw.types';

/** 新建/更新 Agent 的入参（校验由 DTO 完成） */
export type AgentInput = Partial<Omit<ClawAgent, 'id' | 'createdAt'>> & { name?: string };

/** 新建/更新 Model 的入参 */
export type ModelInput = Partial<Omit<ClawModel, 'id'>> & { name?: string };

/** 新建/更新 Tool 的入参 */
export type ToolInput = Partial<ClawTool> & { name?: string };

function genId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

/**
 * CyberClaw 配置存储服务
 *
 * 负责读写仓库根目录的 CyberClaw.json：
 *   - 文件不存在时自动创建默认配置（含 8 个内置工具）
 *   - 所有写操作通过串行队列执行，避免并发写入互相覆盖
 *   - 写入采用「临时文件 + rename」原子替换，防止写一半损坏配置
 *   - 写入前做 Agent ↔ Models/Tools 的引用联动校验
 */
@Injectable()
export class ClawConfigService {
  private readonly logger = new Logger(ClawConfigService.name);
  private readonly configPath: string;
  /** 串行化写操作 */
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor() {
    this.configPath = resolveConfigFilePath();
    this.logger.log(`CyberClaw config file: ${this.configPath}`);
  }

  getConfigPath(): string {
    return this.configPath;
  }

  /** 读取完整配置 */
  loadConfig(): CyberClawConfig {
    try {
      if (existsSync(this.configPath)) {
        const raw = JSON.parse(readFileSync(this.configPath, 'utf-8')) as Partial<CyberClawConfig>;
        return normalizeConfig(raw);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new InternalServerErrorException(
        `Failed to read config file ${this.configPath}: ${message}`,
      );
    }
    return defaultConfig();
  }

  /** 原子写入完整配置（串行）；写入前做引用联动校验 */
  async saveConfig(config: CyberClawConfig): Promise<void> {
    const normalized = normalizeConfig(config);
    this.validateLinks(normalized);
    this.writeQueue = this.writeQueue.then(() => this.persist(normalized));
    return this.writeQueue as Promise<void>;
  }

  private async persist(config: CyberClawConfig): Promise<void> {
    try {
      await mkdir(dirname(this.configPath), { recursive: true });
      const tmpPath = `${this.configPath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
      await rename(tmpPath, this.configPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new InternalServerErrorException(
        `Failed to write config file ${this.configPath}: ${message}`,
      );
    }
  }

  /**
   * 引用联动校验（写库前统一执行）：
   *   - 每个 agent 必须关联大模型，且 modelId 必须存在于 models
   *   - agent.tools 中的每个工具名必须存在于 tools
   */
  private validateLinks(config: CyberClawConfig): void {
    const modelIds = new Set(config.models.map((m) => m.id));
    const toolNames = new Set(config.tools.map((t) => t.name));

    for (const agent of config.agents) {
      if (!agent.modelId) {
        throw new UnprocessableEntityException(`智能体「${agent.name}」未关联大模型`);
      }
      if (!modelIds.has(agent.modelId)) {
        throw new UnprocessableEntityException(
          `智能体「${agent.name}」关联的大模型不存在: ${agent.modelId}`,
        );
      }
      for (const tool of agent.tools) {
        if (!toolNames.has(tool)) {
          throw new UnprocessableEntityException(`智能体「${agent.name}」关联的工具不存在: ${tool}`);
        }
      }
    }
  }

  // ==================== Agents 管理 ====================

  listAgents(): ClawAgent[] {
    return this.loadConfig().agents;
  }

  getAgent(id: string): ClawAgent | undefined {
    return this.loadConfig().agents.find((a) => a.id === id);
  }

  /** 创建 Agent；关联的大模型必填且必须存在，工具必须存在 */
  async createAgent(input: AgentInput): Promise<ClawAgent> {
    const config = this.loadConfig();
    const name = input.name?.trim();
    if (!name) {
      throw new UnprocessableEntityException('智能体名称不能为空');
    }

    this.assertAgentLinks(config, input);

    if (config.agents.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException(`Agent "${name}" already exists`);
    }

    const agent: ClawAgent = {
      id: genId('ag'),
      name,
      description: input.description,
      systemPrompt: input.systemPrompt,
      modelId: input.modelId,
      tools: Array.isArray(input.tools) ? input.tools : [],
      enabled: input.enabled ?? true,
      createdAt: new Date().toISOString(),
    };

    config.agents.push(agent);
    await this.saveConfig(config);
    return agent;
  }

  /** 更新 Agent；不存在抛 404，重名（排除自身）抛 409 */
  async updateAgent(id: string, patch: AgentInput): Promise<ClawAgent> {
    const config = this.loadConfig();
    const agent = config.agents.find((a) => a.id === id);
    if (!agent) {
      throw new NotFoundException(`Agent ${id} not found`);
    }

    const nextName = patch.name?.trim();
    if (nextName) {
      const conflict = config.agents.some(
        (a) => a.id !== id && a.name.toLowerCase() === nextName.toLowerCase(),
      );
      if (conflict) {
        throw new ConflictException(`Agent "${nextName}" already exists`);
      }
    }

    // 若调整了 modelId / tools，先校验引用
    if (patch.modelId !== undefined || Array.isArray(patch.tools)) {
      this.assertAgentLinks(config, {
        ...patch,
        modelId: patch.modelId ?? agent.modelId,
        tools: Array.isArray(patch.tools) ? patch.tools : agent.tools,
      });
    }

    const updated: ClawAgent = {
      ...agent,
      name: nextName ?? agent.name,
      description: patch.description !== undefined ? patch.description : agent.description,
      systemPrompt: patch.systemPrompt !== undefined ? patch.systemPrompt : agent.systemPrompt,
      modelId: patch.modelId !== undefined ? patch.modelId : agent.modelId,
      tools: Array.isArray(patch.tools) ? patch.tools : agent.tools,
      enabled: patch.enabled !== undefined ? patch.enabled : agent.enabled,
    };

    config.agents[config.agents.indexOf(agent)] = updated;
    await this.saveConfig(config);
    return updated;
  }

  /** 删除 Agent；不存在抛 404 */
  async deleteAgent(id: string): Promise<void> {
    const config = this.loadConfig();
    const index = config.agents.findIndex((a) => a.id === id);
    if (index === -1) {
      throw new NotFoundException(`Agent ${id} not found`);
    }
    config.agents.splice(index, 1);
    await this.saveConfig(config);
  }

  /** 校验 agent 的 modelId / tools 引用是否有效 */
  private assertAgentLinks(config: CyberClawConfig, input: AgentInput): void {
    if (!input.modelId) {
      throw new UnprocessableEntityException('请为智能体选择关联大模型（必填）');
    }
    if (!config.models.some((m) => m.id === input.modelId)) {
      throw new UnprocessableEntityException(`关联的大模型不存在: ${input.modelId}`);
    }
    for (const tool of input.tools ?? []) {
      if (!config.tools.some((t) => t.name === tool)) {
        throw new UnprocessableEntityException(`关联的工具不存在: ${tool}`);
      }
    }
  }

  // ==================== Models 管理 ====================

  listModels(): ClawModel[] {
    return this.loadConfig().models;
  }

  getModel(id: string): ClawModel | undefined {
    return this.loadConfig().models.find((m) => m.id === id);
  }

  /** 创建 Model；重名抛 409；第一个模型自动设为默认 */
  async createModel(input: ModelInput): Promise<ClawModel> {
    const config = this.loadConfig();
    const name = input.name?.trim();
    if (!name) {
      throw new UnprocessableEntityException('模型配置名称不能为空');
    }
    if (config.models.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException(`Model "${name}" already exists`);
    }

    const isDefault = input.isDefault ?? config.models.length === 0;
    if (isDefault) {
      config.models.forEach((m) => (m.isDefault = false));
    }

    const model: ClawModel = {
      id: genId('mdl'),
      provider: input.provider ?? 'custom',
      name,
      model: input.model ?? '',
      baseUrl: input.baseUrl ?? '',
      apiKey: input.apiKey ?? '',
      enabled: input.enabled ?? true,
      isDefault,
    };

    config.models.push(model);
    await this.saveConfig(config);
    return model;
  }

  /** 更新 Model；isDefault=true 时清除其他模型的默认标记 */
  async updateModel(id: string, patch: ModelInput): Promise<ClawModel> {
    const config = this.loadConfig();
    const model = config.models.find((m) => m.id === id);
    if (!model) {
      throw new NotFoundException(`Model ${id} not found`);
    }

    const nextName = patch.name?.trim();
    if (nextName) {
      const conflict = config.models.some(
        (m) => m.id !== id && m.name.toLowerCase() === nextName.toLowerCase(),
      );
      if (conflict) {
        throw new ConflictException(`Model "${nextName}" already exists`);
      }
    }

    const updated: ClawModel = {
      ...model,
      name: nextName ?? model.name,
      provider: patch.provider ?? model.provider,
      model: patch.model ?? model.model,
      baseUrl: patch.baseUrl ?? model.baseUrl,
      apiKey: patch.apiKey !== undefined ? patch.apiKey : model.apiKey,
      enabled: patch.enabled !== undefined ? patch.enabled : model.enabled,
      isDefault: patch.isDefault !== undefined ? patch.isDefault : model.isDefault,
    };

    if (updated.isDefault) {
      config.models.forEach((m) => {
        if (m.id !== id) m.isDefault = false;
      });
    }

    config.models[config.models.indexOf(model)] = updated;
    await this.saveConfig(config);
    return updated;
  }

  /** 删除 Model；被 Agent 引用时抛 409；删除默认模型后自动提升第一个为默认 */
  async deleteModel(id: string): Promise<void> {
    const config = this.loadConfig();
    const index = config.models.findIndex((m) => m.id === id);
    if (index === -1) {
      throw new NotFoundException(`Model ${id} not found`);
    }
    const model = config.models[index];

    const referencing = config.agents.filter((a) => a.modelId === id);
    if (referencing.length > 0) {
      throw new ConflictException(
        `模型「${model.name}」正被 ${referencing.length} 个智能体使用（${referencing
          .map((a) => a.name)
          .join('、')}），请先解除关联`,
      );
    }

    config.models.splice(index, 1);
    if (model.isDefault && config.models.length > 0) {
      config.models[0].isDefault = true;
    }
    await this.saveConfig(config);
  }

  // ==================== Tools 管理 ====================

  listTools(): ClawTool[] {
    return this.loadConfig().tools;
  }

  getTool(name: string): ClawTool | undefined {
    return this.loadConfig().tools.find((t) => t.name === name);
  }

  /** 创建 Tool；与已有工具（含内置）重名抛 409 */
  async createTool(input: ToolInput): Promise<ClawTool> {
    const config = this.loadConfig();
    const name = input.name?.trim();
    if (!name) {
      throw new UnprocessableEntityException('工具名称不能为空');
    }
    if (config.tools.some((t) => t.name === name)) {
      throw new ConflictException(`Tool "${name}" already exists`);
    }

    const tool: ClawTool = {
      name,
      label: input.label ?? name,
      description: input.description ?? '',
      builtin: input.builtin ?? false,
      enabled: input.enabled ?? true,
      icon: input.icon,
    };

    config.tools.push(tool);
    await this.saveConfig(config);
    return tool;
  }

  /** 更新 Tool；内置工具不可重命名 */
  async updateTool(name: string, patch: ToolInput): Promise<ClawTool> {
    const config = this.loadConfig();
    const tool = config.tools.find((t) => t.name === name);
    if (!tool) {
      throw new NotFoundException(`Tool ${name} not found`);
    }

    const nextName = patch.name?.trim();
    if (nextName && nextName !== name) {
      if (tool.builtin) {
        throw new ConflictException('内置工具不可重命名');
      }
      const conflict = config.tools.some((t) => t.name === nextName);
      if (conflict) {
        throw new ConflictException(`Tool "${nextName}" already exists`);
      }
    }

    const updated: ClawTool = {
      ...tool,
      name: nextName ?? tool.name,
      label: patch.label ?? tool.label,
      description: patch.description !== undefined ? patch.description : tool.description,
      enabled: patch.enabled !== undefined ? patch.enabled : tool.enabled,
      icon: patch.icon !== undefined ? patch.icon : tool.icon,
    };

    config.tools[config.tools.indexOf(tool)] = updated;
    await this.saveConfig(config);
    return updated;
  }

  /** 删除 Tool；内置工具不可删；被 Agent 引用时抛 409 */
  async deleteTool(name: string): Promise<void> {
    const config = this.loadConfig();
    const index = config.tools.findIndex((t) => t.name === name);
    if (index === -1) {
      throw new NotFoundException(`Tool ${name} not found`);
    }
    const tool = config.tools[index];

    if (tool.builtin) {
      throw new ConflictException('内置工具不可删除');
    }

    const referencing = config.agents.filter((a) => a.tools.includes(name));
    if (referencing.length > 0) {
      throw new ConflictException(
        `工具「${tool.label}」正被 ${referencing.length} 个智能体使用（${referencing
          .map((a) => a.name)
          .join('、')}），请先解除关联`,
      );
    }

    config.tools.splice(index, 1);
    await this.saveConfig(config);
  }
}
