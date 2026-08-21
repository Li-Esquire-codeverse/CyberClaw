import { Logger } from '@nestjs/common';
import { exec, type ExecOptions } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { findMonorepoRoot } from '../claw/config-path';

/**
 * shell 真实执行器
 *
 * 在本地执行 shell 命令（Windows 用 cmd，其余平台用 /bin/sh），
 * 返回 stdout / stderr 与退出码。命令非零退出视为「正常执行结果」返回
 * （不标 [工具错误]），让模型能根据报错自行迭代修复。
 *
 * 参数：
 *   - command    要执行的命令（必填）
 *   - timeoutSec 超时秒数（默认 30，最大 120，超时强制终止）
 *   - cwd        工作目录（相对于工作区根，默认工作区根）
 *
 * 安全：
 *   - cwd 限制在工作区根内（SHELL_ROOT 可覆盖，默认 monorepo 根）
 *   - 输出截断（各 4000 字符），防大输出撑爆上下文
 *   - 该工具默认在 CyberClaw.json 中 enabled=false，需用户显式开启
 */
const ENV_ROOT = 'SHELL_ROOT';
const DEFAULT_TIMEOUT_SEC = 30;
const MAX_TIMEOUT_SEC = 120;
const MAX_OUTPUT_CHARS = 4000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

const logger = new Logger('ShellExecutor');

/**
 * promisify(exec) 的类型推断会选中错误的 exec 重载（shell:boolean 报错），
 * 这里手动包 Promise 并透传 stdout/stderr 到错误对象。
 */
function runExec(
  command: string,
  options: ExecOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    exec(command, options, (err, stdout, stderr) => {
      if (err) {
        const e = err as Error & { stdout?: string; stderr?: string };
        e.stdout = String(stdout);
        e.stderr = String(stderr);
        reject(e);
      } else {
        resolvePromise({ stdout: String(stdout), stderr: String(stderr) });
      }
    });
  });
}

/** @types/node 22 的 ExecOptions.shell 只接受 string，显式指定 shell 路径 */
function defaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'cmd.exe';
  }
  return '/bin/sh';
}

function toErrorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 参数安全取值：number | 数字字符串 | 默认值 */
function toInt(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const raw = args[key];
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolveRoot(): string {
  const explicit = process.env[ENV_ROOT];
  if (explicit) {
    return resolve(explicit);
  }
  return findMonorepoRoot() ?? process.cwd();
}

function resolveCwd(input: string | undefined): string {
  const root = resolveRoot();
  if (!input) {
    return root;
  }
  if (isAbsolute(input)) {
    throw new Error(`不允许使用绝对路径作为 cwd: ${input}`);
  }
  const full = resolve(root, input);
  const rel = relative(root, full);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`cwd 越出工作区根: ${input}`);
  }
  return full;
}

function truncate(text: string): string {
  const trimmed = text.trimEnd();
  if (trimmed.length <= MAX_OUTPUT_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_OUTPUT_CHARS)}\n…（输出过长，已截断 ${
    trimmed.length - MAX_OUTPUT_CHARS
  } 字符）`;
}

/** shell 工具执行器（ToolExecutor 签名） */
export async function shellExecutor(
  args: Record<string, unknown>,
): Promise<string> {
  const command = String(args.command ?? '').trim();
  if (!command) {
    return '[工具错误] shell 缺少参数 command';
  }
  const timeoutSec = Math.min(
    toInt(args, 'timeoutSec', DEFAULT_TIMEOUT_SEC),
    MAX_TIMEOUT_SEC,
  );

  let cwd: string;
  try {
    cwd = resolveCwd(args.cwd ? String(args.cwd).trim() : undefined);
  } catch (err) {
    return `[工具错误] shell cwd 无效: ${toErrorText(err)}`;
  }

  try {
    const { stdout, stderr } = await runExec(command, {
      cwd,
      shell: defaultShell(),
      timeout: timeoutSec * 1000,
      maxBuffer: MAX_BUFFER_BYTES,
      windowsHide: true,
      env: process.env,
    });
    const parts: string[] = [];
    const out = truncate(stdout);
    const errOut = truncate(stderr);
    if (out) parts.push(`--- stdout ---\n${out}`);
    if (errOut) parts.push(`--- stderr ---\n${errOut}`);
    return parts.length ? parts.join('\n\n') : '（命令执行成功，无输出）';
  } catch (err) {
    const e = err as {
      code?: number | string;
      signal?: string;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
    };
    // 非零退出码：属于命令本身的执行结果，不作为工具错误返回
    if (typeof e.code === 'number' || typeof e.code === 'string') {
      const lines: string[] = [`退出码: ${e.code}`];
      const out = e.stdout ? truncate(String(e.stdout)) : '';
      const errOut = e.stderr ? truncate(String(e.stderr)) : '';
      if (out) lines.push(`--- stdout ---\n${out}`);
      if (errOut) lines.push(`--- stderr ---\n${errOut}`);
      return lines.join('\n\n');
    }
    // 超时被杀 / 无法启动等基础设施错误
    if (e.killed || e.signal) {
      logger.warn(`shell command timed out after ${timeoutSec}s: ${command}`);
      return `[工具错误] shell 执行超时（超过 ${timeoutSec} 秒被终止）`;
    }
    const message = toErrorText(err);
    logger.warn(`shell failed (command=${command}): ${message}`);
    return `[工具错误] shell 执行失败: ${message}`;
  }
}
