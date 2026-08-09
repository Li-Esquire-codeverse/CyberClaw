import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

  let dir = process.cwd();
  for (;;) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { workspaces?: unknown };
        if (pkg.workspaces) {
          return join(dir, 'CyberClaw.json');
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

  return join(process.cwd(), 'CyberClaw.json');
}
