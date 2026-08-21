import { Logger } from '@nestjs/common';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { findMonorepoRoot } from '../claw/config-path';

/**
 * file-ops 真实执行器
 *
 * 操作（operation 参数）：
 *   - read   读取文件内容（目录则列目录）
 *   - write  写入文件（自动创建父目录）
 *   - list   列出目录内容（recursive=true 时递归列出子树）
 *   - mkdir  创建目录（recursive=true 允许嵌套创建）
 *   - move   移动/重命名（target 为目标路径）
 *   - delete 删除文件或目录（目录需 recursive=true）
 *   - stat   查看文件/目录元信息
 *
 * 路径安全：所有 path 相对于工作区根（FILE_OPS_ROOT 环境变量可覆盖，
 * 默认取 monorepo 根 = 含 workspaces 的 package.json 所在目录）。
 * 绝对路径、以及越出根目录（..）的路径一律拒绝。
 */
const ENV_ROOT = 'FILE_OPS_ROOT';
const MAX_READ_LEN = 50_000;
/** 递归列出时跳过隐藏项与 node_modules，避免爆炸 */
const SKIP_NAMES = new Set(['node_modules', '.git', '.umi', 'dist', '.turbo']);

const logger = new Logger('FileOpsExecutor');

function toErrorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function resolveRoot(): string {
  const explicit = process.env[ENV_ROOT];
  if (explicit) {
    return resolve(explicit);
  }
  return findMonorepoRoot() ?? process.cwd();
}

/** 将用户提供的路径安全解析到 root 内；越界/绝对路径抛错 */
function resolveSafePath(input: string): string {
  const root = resolveRoot();
  if (isAbsolute(input)) {
    throw new Error(`不允许使用绝对路径: ${input}`);
  }
  const full = resolve(root, input);
  const rel = relative(root, full);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`路径越出工作区根: ${input}`);
  }
  return full;
}

async function readOp(full: string, display: string): Promise<string> {
  const info = await stat(full);
  if (info.isDirectory()) {
    return listOp(full, display, false);
  }
  const buf = await readFile(full);
  if (buf.length > MAX_READ_LEN) {
    return `文件较大（${buf.length} 字节），仅显示前 ${MAX_READ_LEN} 字节：\n\n${buf.toString(
      'utf-8',
      0,
      MAX_READ_LEN,
    )}`;
  }
  return buf.toString('utf-8');
}

async function listOp(
  full: string,
  display: string,
  recursive: boolean,
): Promise<string> {
  if (recursive) {
    const rows = await walk(full, display, 0, 3);
    return `目录 ${display} 共 ${rows.length} 项（递归，最多 3 层）：\n${rows.join('\n')}`;
  }
  const entries = await readdir(full, { withFileTypes: true });
  const rows = await Promise.all(
    entries
      .filter((e) => !SKIP_NAMES.has(e.name))
      .map(async (e) => {
        if (e.isDirectory()) return `[DIR]  ${e.name}/`;
        try {
          const s = await stat(join(full, e.name));
          return `[FILE] ${e.name} (${s.size} 字节)`;
        } catch {
          return `[FILE] ${e.name}`;
        }
      }),
  );
  return `目录 ${display} 共 ${rows.length} 项：\n${rows.sort().join('\n')}`;
}

async function walk(
  full: string,
  display: string,
  depth: number,
  maxDepth: number,
): Promise<string[]> {
  const entries = await readdir(full, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (SKIP_NAMES.has(e.name) || e.name.startsWith('.')) continue;
    const childFull = join(full, e.name);
    const childDisplay = `${display}/${e.name}`;
    if (e.isDirectory()) {
      out.push(`[DIR]  ${childDisplay}/`);
      if (depth < maxDepth) {
        out.push(...(await walk(childFull, childDisplay, depth + 1, maxDepth)));
      }
    } else {
      try {
        const s = await stat(childFull);
        out.push(`[FILE] ${childDisplay} (${s.size} 字节)`);
      } catch {
        out.push(`[FILE] ${childDisplay}`);
      }
    }
  }
  return out;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} 字节`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** file-ops 工具执行器（ToolExecutor 签名） */
export async function fileOpsExecutor(
  args: Record<string, unknown>,
): Promise<string> {
  const operation = String(args.operation ?? '').trim().toLowerCase();
  const pathArg = String(args.path ?? '').trim();
  if (!operation) {
    return '[工具错误] file-ops 缺少参数 operation（read/write/list/mkdir/move/delete/stat）';
  }
  if (!pathArg) {
    return '[工具错误] file-ops 缺少参数 path';
  }

  try {
    const full = resolveSafePath(pathArg);
    switch (operation) {
      case 'read':
        // 注意：必须 return await，直接 return promise 时拒绝会绕过 try/catch
        return await readOp(full, pathArg);

      case 'write': {
        if (!('content' in args)) {
          return '[工具错误] file-ops write 缺少参数 content';
        }
        const content = String(args.content ?? '');
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, content, 'utf-8');
        const bytes = Buffer.byteLength(content, 'utf-8');
        return `已写入 ${pathArg}（${formatBytes(bytes)}）`;
      }

      case 'list':
        return await listOp(full, pathArg, Boolean(args.recursive));

      case 'mkdir':
        await mkdir(full, { recursive: Boolean(args.recursive) });
        return `已创建目录 ${pathArg}`;

      case 'move': {
        const target = String(args.target ?? '').trim();
        if (!target) {
          return '[工具错误] file-ops move 缺少参数 target';
        }
        const targetFull = resolveSafePath(target);
        await mkdir(dirname(targetFull), { recursive: true });
        await rename(full, targetFull);
        return `已移动 ${pathArg} → ${target}`;
      }

      case 'delete':
        await rm(full, { recursive: Boolean(args.recursive), force: false });
        return `已删除 ${pathArg}`;

      case 'stat': {
        const s = await stat(full);
        const type = s.isDirectory()
          ? '目录'
          : s.isFile()
            ? '文件'
            : '其他';
        return [
          `路径: ${pathArg}`,
          `类型: ${type}`,
          `大小: ${formatBytes(s.size)}`,
          `修改时间: ${s.mtime.toISOString()}`,
        ].join('\n');
      }

      default:
        return `[工具错误] file-ops 不支持的 operation: ${operation}（可选 read/write/list/mkdir/move/delete/stat）`;
    }
  } catch (err) {
    const message = toErrorText(err);
    logger.warn(`file-ops ${operation} failed (path=${pathArg}): ${message}`);
    return `[工具错误] file-ops ${operation} 失败: ${message}`;
  }
}
