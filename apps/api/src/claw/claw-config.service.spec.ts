import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ClawConfigService } from './claw-config.service';
import { ClawAgent } from './claw.types';

describe('ClawConfigService', () => {
  let tempDir: string;
  let configPath: string;
  let service: ClawConfigService;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cyberclaw-test-'));
    configPath = join(tempDir, 'CyberClaw.json');
    process.env.CYBERCLAW_CONFIG_FILE = configPath;
    service = new ClawConfigService();
  });

  afterEach(() => {
    delete process.env.CYBERCLAW_CONFIG_FILE;
    rmSync(tempDir, { recursive: true, force: true });
  });

  /** 快速创建并返回一个模型 */
  async function addModel(name = 'deepseek'): Promise<string> {
    const model = await service.createModel({
      provider: 'deepseek',
      name,
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
    });
    return model.id;
  }

  /** 快速创建并返回一个已关联模型的 agent */
  async function addAgent(modelId: string, name = 'assistant'): Promise<ClawAgent> {
    return service.createAgent({
      name,
      modelId,
      tools: ['web-search'],
    });
  }

  // ==================== 基础 ====================

  it('returns default config when file does not exist', () => {
    expect(service.listAgents()).toEqual([]);
    expect(service.loadConfig().tools.length).toBe(8);
  });

  it('normalizes a hand-edited config missing keys', () => {
    writeFileSync(configPath, JSON.stringify({ agents: [{ id: 'a1' }] }));
    const config = service.loadConfig();
    expect(config.agents).toHaveLength(1);
    expect(config.models).toEqual([]);
    expect(config.tools).toHaveLength(8);
  });

  // ==================== Agents ====================

  it('creates an agent and persists to the config file', async () => {
    const modelId = await addModel();
    const agent = await addAgent(modelId);

    expect(agent.id).toMatch(/^ag_[a-f0-9]{10}$/);
    expect(agent.modelId).toBe(modelId);
    expect(agent.enabled).toBe(true);
    expect(agent.createdAt).toBeDefined();

    const onDisk = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(onDisk.agents).toHaveLength(1);
  });

  it('requires modelId when creating an agent', async () => {
    await expect(service.createAgent({ name: 'no-model' })).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('rejects agent referencing a non-existent model', async () => {
    await expect(
      service.createAgent({ name: 'bad', modelId: 'mdl_none' }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects agent referencing a non-existent tool', async () => {
    const modelId = await addModel();
    await expect(
      service.createAgent({ name: 'bad-tool', modelId, tools: ['nope'] }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects duplicate agent names', async () => {
    const modelId = await addModel();
    await addAgent(modelId, 'assistant');
    await expect(service.createAgent({ name: 'Assistant', modelId })).rejects.toThrow(
      ConflictException,
    );
  });

  it('updates an agent by id (keeps createdAt)', async () => {
    const modelId = await addModel();
    const agent = await addAgent(modelId);
    const updated = await service.updateAgent(agent.id, {
      name: 'assistant-v2',
      enabled: false,
    });

    expect(updated.name).toBe('assistant-v2');
    expect(updated.enabled).toBe(false);
    expect(updated.createdAt).toBe(agent.createdAt);
  });

  it('rejects update to a non-existent model', async () => {
    const modelId = await addModel();
    const agent = await addAgent(modelId);
    await expect(
      service.updateAgent(agent.id, { modelId: 'mdl_none' }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('throws 404 when updating a missing agent', async () => {
    await expect(service.updateAgent('ag_nope', { name: 'x' })).rejects.toThrow(NotFoundException);
  });

  it('deletes an agent by id', async () => {
    const modelId = await addModel();
    const agent = await addAgent(modelId);
    await service.deleteAgent(agent.id);
    expect(service.listAgents()).toHaveLength(0);
    await expect(service.deleteAgent(agent.id)).rejects.toThrow(NotFoundException);
  });

  // ==================== Models ====================

  it('auto-marks the first model as default', async () => {
    await addModel('m1');
    const m2 = await service.createModel({ name: 'm2', model: 'x', baseUrl: 'http://x' });
    const models = service.listModels();
    expect(models[0].isDefault).toBe(true);
    expect(models[1].isDefault).toBe(false);
    expect(m2.id).toMatch(/^mdl_[a-f0-9]{10}$/);
  });

  it('rejects duplicate model names', async () => {
    await addModel('dup');
    await expect(service.createModel({ name: 'DUP', model: 'x', baseUrl: 'http://x' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('clears other defaults when setting a model as default', async () => {
    await addModel('a');
    const b = await service.createModel({ name: 'b', model: 'x', baseUrl: 'http://x' });
    await service.updateModel(b.id, { isDefault: true });
    const models = service.listModels();
    expect(models.find((m) => m.id === b.id)?.isDefault).toBe(true);
    expect(models.filter((m) => m.isDefault)).toHaveLength(1);
  });

  it('promotes the next model as default when deleting the default one', async () => {
    await addModel('a');
    const b = await service.createModel({ name: 'b', model: 'x', baseUrl: 'http://x' });
    const models = service.listModels();
    const firstId = models[0].id;
    await service.deleteModel(firstId);
    const rest = service.listModels();
    expect(rest).toHaveLength(1);
    expect(rest[0].id).toBe(b.id);
    expect(rest[0].isDefault).toBe(true);
  });

  it('blocks deleting a model referenced by an agent', async () => {
    const modelId = await addModel();
    await addAgent(modelId, 'assistant');
    await expect(service.deleteModel(modelId)).rejects.toThrow(ConflictException);
    // 模型仍在
    expect(service.getModel(modelId)).toBeDefined();
  });

  it('throws 404 when deleting a missing model', async () => {
    await expect(service.deleteModel('mdl_nope')).rejects.toThrow(NotFoundException);
  });

  // ==================== Tools ====================

  it('creates a custom tool', async () => {
    const tool = await service.createTool({
      name: 'custom-calc',
      label: '计算器',
      description: '四则运算',
    });
    expect(tool.builtin).toBe(false);
    expect(service.getTool('custom-calc')?.label).toBe('计算器');
  });

  it('rejects tool name colliding with builtin tools', async () => {
    await expect(service.createTool({ name: 'web-search', label: 'x' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects tool name colliding with custom tools', async () => {
    await service.createTool({ name: 'custom-calc', label: 'x' });
    await expect(service.createTool({ name: 'custom-calc', label: 'y' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('blocks renaming a builtin tool', async () => {
    await expect(service.updateTool('web-search', { name: 'search2' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('allows toggling a builtin tool', async () => {
    const updated = await service.updateTool('web-search', { enabled: false });
    expect(updated.enabled).toBe(false);
  });

  it('blocks deleting a builtin tool', async () => {
    await expect(service.deleteTool('web-search')).rejects.toThrow(ConflictException);
  });

  it('blocks deleting a tool referenced by an agent', async () => {
    const modelId = await addModel();
    await service.createTool({ name: 'custom-calc', label: '计算器' });
    await service.createAgent({
      name: 'calc-agent',
      modelId,
      tools: ['custom-calc'],
    });
    await expect(service.deleteTool('custom-calc')).rejects.toThrow(ConflictException);
  });

  it('deletes an unused custom tool', async () => {
    await service.createTool({ name: 'custom-calc', label: 'x' });
    await service.deleteTool('custom-calc');
    expect(service.getTool('custom-calc')).toBeUndefined();
  });

  // ==================== 全量保存联动校验 ====================

  it('rejects a bulk save with a dangling model reference', async () => {
    const modelId = await addModel();
    const agent = await addAgent(modelId);
    const config = service.loadConfig();
    config.models = config.models.filter((m) => m.id !== modelId);
    await expect(service.saveConfig(config)).rejects.toThrow(UnprocessableEntityException);
    // 文件未变，agent 仍在
    expect(service.getAgent(agent.id)).toBeDefined();
  });

  it('rejects a bulk save where an agent has no modelId', async () => {
    const config = service.loadConfig();
    config.agents.push({ id: 'ag_legacy', name: 'legacy', tools: [], enabled: true });
    await expect(service.saveConfig(config)).rejects.toThrow(UnprocessableEntityException);
  });
});
