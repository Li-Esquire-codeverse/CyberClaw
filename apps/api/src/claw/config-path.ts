import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * 从 startDir 向上查找 monorepo 根（package.json 含 workspaces 字段）。
 * 找不到返回 undefined。
 */
export function findMonorepoRoot(
  startDir: string = process.cwd(),
): string | undefined {
  let dir = startDir;
  for (;;) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
          workspaces?: unknown;
        };
        if (pkg.workspaces) {
          return dir;
        }
      } catch {
        // 解析失败则继续向上查找
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

/**
 * 解析 CyberClaw.json 配置文件路径。
 *
 * 优先级：
 *   1. 环境变量 CYBERCLAW_CONFIG_FILE（显式指定）
 *   2. 从当前工作目录向上查找 monorepo 根（package.json 含 workspaces 字段），
 *      配置放在仓库根目录的 CyberClaw.json
 *   3. 兜底：<cwd>/CyberClaw.json
 */
export function resolveConfigFilePath(): string {
  const envPath = process.env.CYBERCLAW_CONFIG_FILE;
  if (envPath) {
    return envPath;
  }

  const root = findMonorepoRoot();
  if (root) {
    return join(root, 'CyberClaw.json');
  }

  return join(process.cwd(), 'CyberClaw.json');
}
