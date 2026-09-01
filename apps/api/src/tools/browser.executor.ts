import { Logger } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolExecutor } from '@cyberclaw/agent-core';
import { findMonorepoRoot } from '../claw/config-path';

/**
 * browser 真实执行器（Playwright chromium，headless）
 *
 * 动作：
 *   - navigate：page.goto(url, { timeout: 15000 })，输出 title + 正文摘要（8000 字符截断）
 *   - click / type：selector 定位（超时 5s）
 *   - extract：selector 文本提取
 *
 * 设计要点（Phase 4 D1/D2）：
 *   - 惰性启动：首次调用才 launch chromium，复用单例（模块级 promise 缓存）
 *   - 独立 profile：launchPersistentContext(<仓库根>/data/browser-profile/，gitignore)
 *   - 降级：浏览器二进制缺失（Executable doesn't exist）→ 明确错误提示，
 *     其他工具不受影响（P6 优雅降级）
 *   - 可测试性：Playwright 整体注入——createBrowserExecutor(factory) 接受
 *     session 工厂，单测注入假 page（goto/title/bodyText/locator），
 *     真实调用不进入单测（P7）
 */
const logger = new Logger('BrowserExecutor');

/** 页面正文 / extract 结果输出截断上限（ADR-8） */
const OUTPUT_MAX_LEN = 8000;

const NAVIGATE_TIMEOUT_MS = 15_000;
const LOCATOR_TIMEOUT_MS = 5_000;

/** locator 动作的容错：元素可能短暂不可见，playwright 自动等待到超时 */
export interface BrowserLocatorLike {
  click(options?: { timeout?: number }): Promise<void>;
  fill(text: string, options?: { timeout?: number }): Promise<void>;
  innerText(options?: { timeout?: number }): Promise<string>;
}

/** 页面对象（Playwright Page 的鸭子类型，单测可注入假实现） */
export interface BrowserPageLike {
  goto(url: string, options?: { timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  /** 页面可见文本（document.body.innerText） */
  bodyText(): Promise<string>;
  locator(selector: string): BrowserLocatorLike;
}

/** 一次浏览器会话（Playwright persistent context + 页面） */
export interface BrowserSessionLike {
  page: BrowserPageLike;
  close(): Promise<void>;
}

export type BrowserSessionFactory = () => Promise<BrowserSessionLike>;

/** 单例缓存（promise 化避免并发重复 launch） */
let sessionPromise: Promise<BrowserSessionLike> | undefined;

/** 真实 Playwright 会话工厂：launchPersistentContext(独立 profile) + 惰性单例 */
async function defaultSessionFactory(): Promise<BrowserSessionLike> {
  // @cyberclaw/agent-core 为 ESM 包：Node ≥22.12 原生支持 require(esm)。
  // playwright 主包亦按此 require 方式加载，保证 Jest（无 --experimental-vm-modules）可运行。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chromium } = require('playwright') as typeof import('playwright');

  const root = findMonorepoRoot() ?? process.cwd();
  const profileDir = join(root, 'data', 'browser-profile');
  mkdirSync(profileDir, { recursive: true });

  // 独立 user-data-dir：隔离 profile，不碰系统浏览器配置（ADR-7）
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
  });
  const page = await context.newPage();

  return {
    page: {
      goto: (url, options) =>
        page.goto(url, {
          timeout: options?.timeout ?? NAVIGATE_TIMEOUT_MS,
          waitUntil: 'domcontentloaded',
        }),
      title: () => page.title(),
      bodyText: () =>
        page.evaluate(() => document.body?.innerText ?? '') as Promise<string>,
      locator: (selector) => ({
        click: (o) =>
          page.locator(selector).click({ timeout: o?.timeout ?? LOCATOR_TIMEOUT_MS }),
        fill: (text, o) =>
          page.locator(selector).fill(text, {
            timeout: o?.timeout ?? LOCATOR_TIMEOUT_MS,
          }),
        innerText: (o) =>
          page.locator(selector).innerText({
            timeout: o?.timeout ?? LOCATOR_TIMEOUT_MS,
          }),
      }),
    },
    close: () => context.close(),
  };
}

/** 获取（或惰性创建）会话；launch 失败时清缓存允许下次重试 */
async function getSession(factory: BrowserSessionFactory): Promise<BrowserSessionLike> {
  if (!sessionPromise) {
    sessionPromise = factory().catch((err) => {
      sessionPromise = undefined; // 失败重试
      throw err;
    });
  }
  return sessionPromise;
}

function toErrorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 浏览器二进制缺失判定：playwright 未 install chromium 时的典型报错 */
function isBrowserNotInstalled(message: string): boolean {
  return (
    /executable doesn'?t exist/i.test(message) ||
    /please run the following command to download new browsers/i.test(message) ||
    /npx playwright install/i.test(message) ||
    /ERR_BROWSER_NOT_INSTALLED/i.test(message)
  );
}

function isTimeoutError(message: string): boolean {
  return /timeout|timed out|导航超时/i.test(message);
}

/** 截断到 OUTPUT_MAX_LEN，超长时附加截断提示 */
function truncate(text: string, maxLen = OUTPUT_MAX_LEN): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}\n…[内容过长已截断]`;
}

function validateUrl(url: string): string | null {
  if (!/^https?:\/\/.+/i.test(url)) {
    return 'url 必须以 http:// 或 https:// 开头';
  }
  return null;
}

/** 动作参数预检：返回错误文本（合法返回 null），避免无效参数启动浏览器 */
function validateArgs(
  action: string,
  args: Record<string, unknown>,
): string | null {
  switch (action) {
    case 'navigate': {
      const url = String(args.url ?? '').trim();
      if (!url) return '缺少参数 url';
      return validateUrl(url);
    }
    case 'click': {
      const selector = String(args.selector ?? '').trim();
      if (!selector) return '缺少参数 selector';
      return null;
    }
    case 'type': {
      const selector = String(args.selector ?? '').trim();
      if (!selector) return '缺少参数 selector';
      if (!String(args.text ?? '')) return '缺少参数 text';
      return null;
    }
    case 'extract': {
      const selector = String(args.selector ?? '').trim();
      if (!selector) return '缺少参数 selector';
      return null;
    }
    default:
      return null; // 不支持的动作由 switch 兜底报错
  }
}

/** browser 工具执行器工厂（注入 session 工厂便于单测） */
export function createBrowserExecutor(
  factory: BrowserSessionFactory = defaultSessionFactory,
): ToolExecutor {
  return async (args: Record<string, unknown>): Promise<string> => {
    const action = String(args.action ?? '').trim().toLowerCase();
    if (!action) {
      return '[工具错误] browser 缺少参数 action（navigate/click/type/extract）';
    }

    // 参数预检：不合法参数不启动浏览器（避免无谓 launch 开销）
    const precheck = validateArgs(action, args);
    if (precheck) {
      return `[工具错误] browser ${action} 参数不合法: ${precheck}`;
    }

    let session: BrowserSessionLike;
    try {
      session = await getSession(factory);
    } catch (err) {
      const message = toErrorText(err);
      if (isBrowserNotInstalled(message)) {
        return 'browser 工具未就绪：请运行 npx playwright install chromium 安装浏览器后重试（其他工具不受影响）';
      }
      logger.warn(`browser launch failed: ${message}`);
      return `[工具错误] browser 启动失败: ${message}`;
    }

    const { page } = session;
    try {
      switch (action) {
        case 'navigate': {
          const url = String(args.url ?? '').trim();
          const start = Date.now();
          await page.goto(url, { timeout: NAVIGATE_TIMEOUT_MS });
          const [title, body] = await Promise.all([
            page.title(),
            page.bodyText(),
          ]);
          const elapsedMs = Date.now() - start;
          return [
            `已打开页面: ${url}`,
            `标题: ${title || '（无标题）'}`,
            `耗时: ${elapsedMs}ms`,
            '',
            '页面正文：',
            truncate((body || '（页面无可见文本）').trim()),
          ].join('\n');
        }

        case 'click': {
          const selector = String(args.selector ?? '').trim();
          await page.locator(selector).click({ timeout: LOCATOR_TIMEOUT_MS });
          return `已点击元素: ${selector}`;
        }

        case 'type': {
          const selector = String(args.selector ?? '').trim();
          const text = String(args.text ?? '');
          await page.locator(selector).fill(text, { timeout: LOCATOR_TIMEOUT_MS });
          return `已在 ${selector} 输入文本（${text.length} 字符）`;
        }

        case 'extract': {
          const selector = String(args.selector ?? '').trim();
          const text = await page
            .locator(selector)
            .innerText({ timeout: LOCATOR_TIMEOUT_MS });
          return truncate((text ?? '').trim() || '（该元素无可提取文本）');
        }

        default:
          return `[工具错误] browser 不支持的 action: ${action}（可选 navigate/click/type/extract）`;
      }
    } catch (err) {
      const message = toErrorText(err);
      // 二进制缺失也可能在 goto 阶段才暴露（如用户 profile 损坏），统一降级
      if (isBrowserNotInstalled(message)) {
        return 'browser 工具未就绪：请运行 npx playwright install chromium 安装浏览器后重试（其他工具不受影响）';
      }
      const hint = isTimeoutError(message)
        ? '（操作超时，元素可能不存在或页面加载缓慢）'
        : '';
      logger.warn(`browser ${action} failed: ${message}`);
      return `[工具错误] browser ${action} 失败: ${message}${hint}`;
    }
  };
}

/** 默认实例（tool-executors 注册用） */
export const browserExecutor = createBrowserExecutor();
