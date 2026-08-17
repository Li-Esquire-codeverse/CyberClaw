import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  findRepoRoot,
  loadAgentRuntimeConfig,
  loadConfig,
  resolveConfigPath,
} from './config.js';

/** 构造一个临时「仓库根」：package.json(含 workspaces) + CyberClaw.json */
function makeFakeRepo(cfg: unknown): { root: string; configPath: string; cwd: string } {
  const root = mkdtempSync(join(tmpdir(), 'claw-config-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ workspaces: ['apps/*'] }));
  const configPath = join(root, 'CyberClaw.json');
  writeFileSync(configPath, JSON.stringify(cfg));
  // cwd 指向根的子目录，验证向上查找
  const cwd = join(root, 'apps', 'webui');
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, 'dummy.txt'), '');
  return { root, configPath, cwd };
}

const sampleCfg = {
  agents: [
    {
      id: 'ag_1',
      name: '测试助手',
      systemPrompt: '你是测试助手',
      modelId: 'mdl_1',
      tools: ['echo'],
      enabled: true,
    },
  ],
  models: [
    {
      id: 'mdl_1',
      provider: 'deepseek',
      name: 'DeepSeek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      enabled: true,
      isDefault: true,
    },
    {
      id: 'mdl_2',
      provider: 'ollama',
      name: '本地模型',
      model: 'qwen2.5',
      baseUrl: 'http://localhost:11434/v1',
      enabled: false,
    },
  ],
  tools: [
    { name: 'echo', label: '回显', description: '回显文本', enabled: true },
    { name: 'web-search', label: '网页搜索', description: '搜索', enabled: false },
  ],
};

describe('loadConfig 配置读取', () => {
  let repo: ReturnType<typeof makeFakeRepo>;
  const oldEnv = process.env.CYBERCLAW_CONFIG_FILE;

  beforeAll(() => {
    repo = makeFakeRepo(sampleCfg);
  });
  afterAll(() => {
    rmSync(repo.root, { recursive: true, force: true });
    if (oldEnv === undefined) delete process.env.CYBERCLAW_CONFIG_FILE;
    else process.env.CYBERCLAW_CONFIG_FILE = oldEnv;
  });

  it('从 cwd 向上查找仓库根并读取配置', () => {
    const root = findRepoRoot(repo.cwd);
    expect(root).toBe(repo.root);

    const config = loadConfig({ cwd: repo.cwd });
    expect(config.models).toHaveLength(2);
    expect(config.tools).toHaveLength(2);
    expect(config.agents[0]!.name).toBe('测试助手');
  });

  it('resolveConfigPath 优先级：显式 configFile > env > 仓库根', () => {
    expect(resolveConfigPath({ cwd: repo.cwd })).toBe(repo.configPath);
    try {
      // env 覆盖仓库根
      process.env.CYBERCLAW_CONFIG_FILE = join(repo.root, 'env-cover.json');
      expect(resolveConfigPath({ cwd: repo.cwd })).toBe(process.env.CYBERCLAW_CONFIG_FILE);
      // 显式参数最高优先级
      expect(
        resolveConfigPath({ cwd: repo.cwd, configFile: join(repo.root, 'explicit.json') }),
      ).toBe(join(repo.root, 'explicit.json'));
    } finally {
      // 清理 env，避免污染后续用例
      delete process.env.CYBERCLAW_CONFIG_FILE;
    }
  });

  it('loadAgentRuntimeConfig 只返回启用项（封装方法）', () => {
    const runtime = loadAgentRuntimeConfig({ cwd: repo.cwd });
    expect(runtime.models).toHaveLength(1);
    expect(runtime.models[0]!.id).toBe('mdl_1');
    expect(runtime.tools).toHaveLength(1);
    expect(runtime.tools[0]!.name).toBe('echo');
  });

  it('配置文件不存在时返回空配置而非抛错', () => {
    const empty = loadConfig({ cwd: repo.cwd, configFile: join(repo.root, 'nope.json') });
    expect(empty).toEqual({ agents: [], models: [], tools: [] });
  });

  it('解析损坏的 JSON 时抛错', () => {
    const bad = mkdtempSync(join(tmpdir(), 'claw-bad-'));
    writeFileSync(join(bad, 'CyberClaw.json'), '{ not json');
    expect(() => loadConfig({ cwd: bad })).toThrow();
    rmSync(bad, { recursive: true, force: true });
  });
});
