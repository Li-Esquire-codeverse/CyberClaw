import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findRepoRoot } from '@cyberclaw/agent-core';

/**
 * 轻量 .env 加载（Node ≥20.6 原生 process.loadEnvFile，零新增依赖）。
 *
 * 查找顺序（取第一个存在的）：
 *   1. <仓库根>/apps/api/.env   —— 开发默认（npm run start:dev -w apps/api 时 cwd=apps/api）
 *   2. <cwd>/.env              —— 直接在 dist 目录运行等场景
 *
 * 语义：已存在的环境变量优先（loadEnvFile 不覆盖 process.env 已有值），
 * 系统环境变量 > .env 文件，符合惯例且安全。
 *
 * 注意：本文件只负责加载，绝不输出/记录 .env 中的值。
 */
const candidates = [
  join(findRepoRoot(process.cwd()) ?? process.cwd(), 'apps', 'api', '.env'),
  resolve(process.cwd(), '.env'),
];

for (const file of candidates) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}
