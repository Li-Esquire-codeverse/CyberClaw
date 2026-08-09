import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClawConfigService } from './claw-config.service';
import { defaultConfig } from './claw.types';

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

  it('returns default config when file does not exist', () => {
    expect(service.listAgents()).toEqual([]);
    expect(service.loadConfig().tools.length).toBe(8);
  });

  it('creates an agent and persists to the config file', async () => {
    const agent = await service.createAgent({
      name: 'assistant',
      description: '默认助手',
      modelId: 'deepseek-chat',
      tools: ['web-search', 'browser'],
    });

    expect(agent.id).toMatch(/^ag_[a-f0-9]{10}$/);
    expect(agent.enabled).toBe(true);
    expect(agent.createdAt).toBeDefined();

    // 文件确实写入了
    const onDisk = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(onDisk.agents).toHaveLength(1);
    expect(onDisk.agents[0].name).toBe('assistant');
  });

  it('rejects duplicate agent names', async () => {
    await service.createAgent({ name: 'assistant' });
    await expect(service.createAgent({ name: 'Assistant' })).rejects.toThrow(ConflictException);
  });

  it('updates an agent by id', async () => {
    const agent = await service.createAgent({ name: 'assistant', enabled: true });
    const updated = await service.updateAgent(agent.id, {
      name: 'assistant-v2',
      enabled: false,
    });

    expect(updated.name).toBe('assistant-v2');
    expect(updated.enabled).toBe(false);
    expect(updated.createdAt).toBe(agent.createdAt);

    // 未传字段保持不变
    expect(service.getAgent(agent.id)?.description).toBeUndefined();
  });

  it('throws 404 when updating a missing agent', async () => {
    await expect(service.updateAgent('ag_nope', { name: 'x' })).rejects.toThrow(NotFoundException);
  });

  it('deletes an agent by id', async () => {
    const agent = await service.createAgent({ name: 'temp' });
    await service.deleteAgent(agent.id);
    expect(service.listAgents()).toHaveLength(0);
    await expect(service.deleteAgent(agent.id)).rejects.toThrow(NotFoundException);
  });

  it('normalizes a hand-edited config missing keys', () => {
    writeFileSync(configPath, JSON.stringify({ agents: [{ id: 'a1' }] }));
    const config = service.loadConfig();
    expect(config.agents).toHaveLength(1);
    expect(config.models).toEqual([]);
    expect(config.tools).toHaveLength(8);
  });
});
