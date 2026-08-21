import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileOpsExecutor } from './file-ops.executor';

describe('fileOpsExecutor', () => {
  const realEnv = { ...process.env };
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cyberclaw-fileops-'));
    process.env.FILE_OPS_ROOT = root;
  });

  afterEach(async () => {
    process.env = { ...realEnv };
    await rm(root, { recursive: true, force: true });
  });

  it('缺少 operation 参数时返回工具错误', async () => {
    const result = await fileOpsExecutor({ path: 'a.txt' });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('operation');
  });

  it('缺少 path 参数时返回工具错误', async () => {
    const result = await fileOpsExecutor({ operation: 'read' });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('path');
  });

  it('write 后 read 能往返一致', async () => {
    const writeRes = await fileOpsExecutor({
      operation: 'write',
      path: 'notes/hello.txt',
      content: '你好，CyberClaw',
    });
    expect(writeRes).toContain('已写入');

    const readRes = await fileOpsExecutor({
      operation: 'read',
      path: 'notes/hello.txt',
    });
    expect(readRes).toBe('你好，CyberClaw');
  });

  it('write 自动创建父目录', async () => {
    await fileOpsExecutor({
      operation: 'write',
      path: 'a/b/c.txt',
      content: 'x',
    });
    const content = await readFile(join(root, 'a', 'b', 'c.txt'), 'utf-8');
    expect(content).toBe('x');
  });

  it('read 不存在的文件返回工具错误', async () => {
    const result = await fileOpsExecutor({
      operation: 'read',
      path: 'missing.txt',
    });
    expect(result).toContain('[工具错误]');
  });

  it('list 目录返回条目与大小', async () => {
    await writeFile(join(root, 'one.txt'), '12345');
    await fileOpsExecutor({ operation: 'mkdir', path: 'sub' });
    const result = await fileOpsExecutor({ operation: 'list', path: '.' });
    expect(result).toContain('one.txt');
    expect(result).toContain('5 字节');
    expect(result).toContain('[DIR]');
  });

  it('mkdir 创建目录', async () => {
    const result = await fileOpsExecutor({
      operation: 'mkdir',
      path: 'deep/nested',
      recursive: true,
    });
    expect(result).toContain('已创建');
  });

  it('move 移动文件并保留内容', async () => {
    await fileOpsExecutor({
      operation: 'write',
      path: 'src.txt',
      content: 'move me',
    });
    const result = await fileOpsExecutor({
      operation: 'move',
      path: 'src.txt',
      target: 'dst/sub.txt',
    });
    expect(result).toContain('src.txt → dst/sub.txt');

    const readRes = await fileOpsExecutor({
      operation: 'read',
      path: 'dst/sub.txt',
    });
    expect(readRes).toBe('move me');
  });

  it('move 缺少 target 返回工具错误', async () => {
    const result = await fileOpsExecutor({
      operation: 'move',
      path: 'src.txt',
    });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('target');
  });

  it('delete 删除文件', async () => {
    await fileOpsExecutor({
      operation: 'write',
      path: 'del.txt',
      content: 'bye',
    });
    const result = await fileOpsExecutor({
      operation: 'delete',
      path: 'del.txt',
    });
    expect(result).toContain('已删除');
    const readRes = await fileOpsExecutor({
      operation: 'read',
      path: 'del.txt',
    });
    expect(readRes).toContain('[工具错误]');
  });

  it('delete 非空目录不带 recursive 返回工具错误', async () => {
    await fileOpsExecutor({
      operation: 'write',
      path: 'dir/file.txt',
      content: 'x',
    });
    const result = await fileOpsExecutor({
      operation: 'delete',
      path: 'dir',
    });
    expect(result).toContain('[工具错误]');
  });

  it('delete 目录带 recursive 成功', async () => {
    await fileOpsExecutor({
      operation: 'write',
      path: 'dir/file.txt',
      content: 'x',
    });
    const result = await fileOpsExecutor({
      operation: 'delete',
      path: 'dir',
      recursive: true,
    });
    expect(result).toContain('已删除');
  });

  it('stat 返回元信息', async () => {
    await fileOpsExecutor({
      operation: 'write',
      path: 'meta.txt',
      content: '1234567890',
    });
    const result = await fileOpsExecutor({
      operation: 'stat',
      path: 'meta.txt',
    });
    expect(result).toContain('类型: 文件');
    expect(result).toContain('大小: 10 字节');
  });

  it('不支持的 operation 返回工具错误', async () => {
    const result = await fileOpsExecutor({
      operation: 'format',
      path: 'a.txt',
    });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('format');
  });

  it('绝对路径被拒绝', async () => {
    const result = await fileOpsExecutor({
      operation: 'read',
      path: 'C:\\Windows\\win.ini',
    });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('绝对路径');
  });

  it('越出工作区根的相对路径被拒绝', async () => {
    const result = await fileOpsExecutor({
      operation: 'read',
      path: '../outside.txt',
    });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('越出');
  });
});
