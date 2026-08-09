import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { resolveConfigFilePath } from './config-path';
import {
  ClawAgent,
  CyberClawConfig,
  defaultConfig,
  normalizeConfig,
} from './claw.types';

/** 新建/更新 Agent 的入参（校验由 DTO 完成） */
export type AgentInput = Partial<Omit<ClawAgent, 'id' | 'createdAt'>> & {
  name?: string;
};

/**
 * CyberClaw 配置存储服务
 *
 * 负责读写仓库根目录的 CyberClaw.json：
 *   - 文件不存在时自动创建默认配置（含 8 个内置工具）
 *   - 所有写操作通过串行队列执行，避免并发写入互相覆盖
 *   - 写入采用「临时文件 + rename」原子替换，防止写一半损坏配置
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

  /** 原子写入完整配置（串行） */
  async saveConfig(config: CyberClawConfig): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.persist(config));
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

  // ==================== Agents 管理 ====================

  listAgents(): ClawAgent[] {
    return this.loadConfig().agents;
  }

  getAgent(id: string): ClawAgent | undefined {
    return this.loadConfig().agents.find((a) => a.id === id);
  }

  /** 创建 Agent；id 冲突或重名抛 409 */
  async createAgent(input: AgentInput): Promise<ClawAgent> {
    const config = this.loadConfig();
    const name = input.name?.trim();
    if (!name) {
      throw new ConflictException('Agent name is required');
    }
    if (config.agents.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException(`Agent "${name}" already exists`);
    }

    const agent: ClawAgent = {
      id: `ag_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
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
}
