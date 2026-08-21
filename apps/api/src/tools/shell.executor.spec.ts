import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shellExecutor } from './shell.executor';

/** Windows 上超时被杀死的进程可能短暂占用 cwd 句柄，重试清理 */
async function rmRetry(dir: string): Promise<void> {
  for (let i = 0; i < 10; i++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

describe('shellExecutor', () => {
  const realEnv = { ...process.env };
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cyberclaw-shell-'));
    process.env.SHELL_ROOT = root;
  });

  afterEach(async () => {
    process.env = { ...realEnv };
    await rmRetry(root);
  });

  it('缺少 command 参数时返回工具错误', async () => {
    const result = await shellExecutor({});
    expect(result).toContain('[工具错误]');
    expect(result).toContain('command');
  });

  it('成功执行命令返回 stdout', async () => {
    const result = await shellExecutor({ command: 'node -e "console.log(\'hello shell\')"' });
    expect(result).toContain('hello shell');
    expect(result).not.toContain('[工具错误]');
  });

  it('stderr 一并返回', async () => {
    const result = await shellExecutor({
      command: 'node -e "console.error(\'oops stderr\')"',
    });
    expect(result).toContain('oops stderr');
    expect(result).not.toContain('[工具错误]');
  });

  it('非零退出码返回退出码信息（不作为工具错误）', async () => {
    const result = await shellExecutor({
      command: 'node -e "process.exit(3)"',
    });
    expect(result).toContain('退出码: 3');
    expect(result).not.toContain('[工具错误]');
  });

  it('输出超长时截断并提示', async () => {
    await writeFile(join(root, 'gen.js'), 'console.log("x".repeat(6000));');
    const result = await shellExecutor({ command: 'node gen.js' });
    expect(result).toContain('已截断');
    expect(result.length).toBeLessThan(4200);
  });

  it('超时被终止时返回工具错误', async () => {
    await writeFile(join(root, 'sleep.js'), 'setTimeout(() => {}, 60000);');
    const result = await shellExecutor({
      command: 'node sleep.js',
      timeoutSec: 1,
    });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('超时');
  }, 20_000);

  it('cwd 越出工作区根时返回工具错误', async () => {
    const result = await shellExecutor({ command: 'echo hi', cwd: '../' });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('cwd');
  });

  it('cwd 为绝对路径时返回工具错误', async () => {
    const result = await shellExecutor({
      command: 'echo hi',
      cwd: 'C:\\Windows',
    });
    expect(result).toContain('[工具错误]');
  });

  it('cwd 限制在根内时在指定目录执行', async () => {
    await writeFile(join(root, 'marker.txt'), 'cwd-ok');
    const result = await shellExecutor({
      command: 'node -e "console.log(process.cwd())"',
      cwd: '.',
    });
    expect(result).toContain(root);
    expect(result).not.toContain('[工具错误]');
  });
});
