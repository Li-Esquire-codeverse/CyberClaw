import { Logger } from '@nestjs/common';
import type { ToolExecutor } from '@cyberclaw/agent-core';
import type { MemoryStore } from '../memory/memory.store';

/**
 * memory 工具执行器（ToolExecutor 签名）
 *
 * 操作：
 *   - add    追加长期记忆（MEMORY.md）或用户画像（USER.md）
 *   - search 关键词检索（MEMORY + USER + 近 N 天 journal）
 *   - list   记忆统计概览
 *
 * 通过 createMemoryExecutor(store) 工厂创建，便于单测注入临时目录的 store。
 */
const logger = new Logger('MemoryExecutor');

const MAX_ADD_TEXT = 500;

/** memory 工具执行器工厂 */
export function createMemoryExecutor(store: MemoryStore): ToolExecutor {
  return async (args: Record<string, unknown>): Promise<string> => {
    const operation = String(args.operation ?? '').trim().toLowerCase();
    if (!operation) {
      return '[工具错误] memory 缺少参数 operation（add/search/list）';
    }

    try {
      switch (operation) {
        case 'add': {
          const text = String(args.text ?? '').trim();
          if (!text) {
            return '[工具错误] memory add 缺少参数 text';
          }
          const target = String(args.target ?? '').trim().toLowerCase();
          const result =
            target === 'user'
              ? await store.appendUserProfile(text)
              : await store.appendMemory(text);
          if (!result.ok) {
            return `[工具错误] memory add 失败: ${result.error ?? '未知错误'}`;
          }
          const preview = text.length > 50 ? `${text.slice(0, 50)}…` : text;
          return `已记住：${preview}${result.truncated ? '（内容较长已截断）' : ''}`;
        }

        case 'search': {
          const query = String(args.query ?? '').trim();
          if (!query) {
            return '[工具错误] memory search 缺少参数 query';
          }
          const limit = Math.min(
            Math.max(Number(args.limit) || 5, 1),
            10,
          );
          const hits = await store.search(query, { limit });
          if (hits.length === 0) {
            return `未找到与「${query}」相关的记忆`;
          }
          return hits
            .map((h, i) => {
              const tag =
                h.source === 'journal'
                  ? `journal/${h.date}`
                  : h.source === 'USER'
                    ? '画像'
                    : '记忆';
              return `${i + 1}. [${tag}] ${h.text}`;
            })
            .join('\n\n');
        }

        case 'list': {
          const stats = await store.getStats();
          const memory = await store.readMemory();
          const user = await store.readUserProfile();
          const memoryLines = memory
            .split('\n')
            .filter((l) => l.trim().startsWith('- ')).length;
          const userLines = user
            .split('\n')
            .filter((l) => l.trim().startsWith('- ')).length;
          return [
            `MEMORY.md: ${memoryLines} 条 / ${stats.memoryBytes} 字节`,
            `USER.md: ${userLines} 条 / ${stats.userBytes} 字节`,
            `journal: ${stats.journalCount} 个文件`,
            stats.lastUpdated ? `最近更新: ${stats.lastUpdated}` : '',
          ]
            .filter(Boolean)
            .join('\n');
        }

        default:
          return `[工具错误] memory 不支持的 operation: ${operation}（可选 add/search/list）`;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`memory ${operation} failed: ${message}`);
      return `[工具错误] memory ${operation} 失败: ${message}`;
    }
  };
}
