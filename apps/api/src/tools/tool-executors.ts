import type { ToolExecutor } from '@cyberclaw/agent-core';
import { webSearchExecutor } from './web-search.executor';
import { translateExecutor } from './translate.executor';
import { fileOpsExecutor } from './file-ops.executor';
import { shellExecutor } from './shell.executor';
import { MemoryStore, MEMORY_STORE, defaultMemoryStore } from '../memory/memory.store';
import { createMemoryExecutor } from './memory.executor';
import { createBrowserExecutor } from './browser.executor';

/**
 * 真实工具执行器注册表（注入到 CHAT_TOOL_EXECUTORS）。
 *
 * 每个执行器按工具名注册；未注册的工具由 agent-core 返回
 * 「[工具未实现]」占位错误（agent 可据此继续作答）。
 *
 * 环境变量配置：
 *   - TAVILY_API_KEY / BRAVE_API_KEY：web-search 搜索提供商（缺省用 DuckDuckGo）
 *   - GOOGLE_TRANSLATE_ENDPOINT：translate 自定义翻译端点（缺省 Google 免费端点，兜底 MyMemory）
 *   - FILE_OPS_ROOT：file-ops 允许访问的工作区根（缺省 monorepo 根）
 *   - SHELL_ROOT：shell 的 cwd 限制根（缺省 monorepo 根）
 *   - MEMORY_JOURNAL_DAYS：memory search 检索近几天日记（缺省 3）
 *   - browser：Playwright chromium 无头浏览器（navigate/click/type/extract）；
 *     二进制缺失时返回「browser 工具未就绪」降级提示，不影响其他工具
 */
export function createToolExecutors(
  memoryStore: MemoryStore = defaultMemoryStore,
): Record<string, ToolExecutor> {
  return {
    'web-search': webSearchExecutor,
    translate: translateExecutor,
    'file-ops': fileOpsExecutor,
    shell: shellExecutor,
    // memory 工具与 ChatService 注入共用同一 store 实例（写队列统一）
    memory: createMemoryExecutor(memoryStore),
    // browser 工具：惰性启动 + 独立 profile（data/browser-profile/，gitignore）
    browser: createBrowserExecutor(),
  };
}
