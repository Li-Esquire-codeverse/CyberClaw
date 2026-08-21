import { Logger } from '@nestjs/common';

/**
 * web-search 真实执行器
 *
 * 搜索提供商策略（按环境变量优先级）：
 *   1. TAVILY_API_KEY  → Tavily Search API（POST，返回结构化 results）
 *   2. BRAVE_API_KEY   → Brave Search API（GET，返回 web.results）
 *   3. 兜底            → Bing HTML 搜索（cn.bing.com，国内可达、无需 key）
 *   4. 最后            → DuckDuckGo HTML 搜索（代理/国际网络可达）
 *
 * 返回给模型的文本为编号列表（title / url / snippet），方便 LLM 引用来源。
 * 失败时返回 `[工具错误] ...` 前缀（ChatService 据此把 tool_end.ok 置为 false）。
 */
const ENV_TAVILY_KEY = 'TAVILY_API_KEY';
const ENV_BRAVE_KEY = 'BRAVE_API_KEY';

const SEARCH_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESULTS = 5;

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

const logger = new Logger('WebSearchExecutor');

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

async function tavilySearch(
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const key = process.env[ENV_TAVILY_KEY]!;
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: maxResults,
      search_depth: 'basic',
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Tavily API 返回 ${res.status}`);
  }
  const data = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
  };
  return (data.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.content ?? '',
  }));
}

async function braveSearch(
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const key = process.env[ENV_BRAVE_KEY]!;
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
    query,
  )}&count=${maxResults}`;
  const res = await fetch(url, {
    headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Brave API 返回 ${res.status}`);
  }
  const data = (await res.json()) as {
    web?: { results?: { title?: string; url?: string; description?: string }[] };
  };
  return (data.web?.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.description ?? '',
  }));
}

const UA_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

/** Bing 搜索：按 li.b_algo 结果块解析 title/url/snippet（国内可达） */
async function bingSearch(
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const res = await fetch(
    `https://cn.bing.com/search?q=${encodeURIComponent(query)}`,
    {
      headers: UA_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    throw new Error(`Bing 返回 ${res.status}`);
  }
  const html = await res.text();
  const results: SearchResult[] = [];
  const blocks = html.split('<li class="b_algo"');
  for (const block of blocks.slice(1)) {
    if (results.length >= maxResults) break;
    const a = /<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/.exec(
      block,
    );
    if (!a) continue;
    const p = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block);
    results.push({
      title: stripTags(a[2]),
      url: a[1],
      snippet: p ? stripTags(p[1]) : undefined,
    });
  }
  if (results.length === 0) {
    throw new Error('Bing 未解析到结果');
  }
  return results;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#0*39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ensp;/g, ' ')
    .replace(/&emsp;/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&#0*183;/g, '·')
    .replace(/&#0*8211;/g, '–')
    .replace(/&#0*8212;/g, '—')
    .replace(/&#0*8216;/g, "'")
    .replace(/&#0*8217;/g, "'")
    .replace(/&#0*8220;/g, '"')
    .replace(/&#0*8221;/g, '"')
    .trim();
}

/** DuckDuckGo 结果链接为重定向 URL（//duckduckgo.com/l/?uddg=<真实URL>） */
function decodeDdgHref(href: string): string {
  const m = /[?&]uddg=([^&]+)/.exec(href);
  const target = m ? decodeURIComponent(m[1]) : href;
  return target.startsWith('http') ? target : href;
}

/** DuckDuckGo HTML 搜索：按 result 块正则解析 title/url/snippet */
async function duckduckgoSearch(
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const res = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    throw new Error(`DuckDuckGo 返回 ${res.status}`);
  }
  const html = await res.text();
  const results: SearchResult[] = [];
  // 每个结果块：<a ... class="result__a" ... href="...">title</a> ... <a class="result__snippet">...
  const blockRe =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) && results.length < maxResults) {
    const title = stripTags(m[2]);
    if (!title) continue;
    // 该块之后最近的 result__snippet
    const after = html.slice(blockRe.lastIndex, blockRe.lastIndex + 4000);
    const sm = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(
      after,
    );
    results.push({
      title,
      url: decodeDdgHref(m[1]),
      snippet: sm ? stripTags(sm[1]) : undefined,
    });
  }
  if (results.length === 0) {
    throw new Error('DuckDuckGo 未解析到结果');
  }
  return results;
}

async function searchWithFallback(
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  if (process.env[ENV_TAVILY_KEY]) {
    return tavilySearch(query, maxResults);
  }
  if (process.env[ENV_BRAVE_KEY]) {
    return braveSearch(query, maxResults);
  }
  try {
    return await bingSearch(query, maxResults);
  } catch (bingErr) {
    // Bing 失败（如海外网络环境）再退 DuckDuckGo
    logger.warn(`bing search failed, falling back to DuckDuckGo: ${toErrorText(bingErr)}`);
    return duckduckgoSearch(query, maxResults);
  }
}

/** web-search 工具执行器（ToolExecutor 签名） */
export async function webSearchExecutor(
  args: Record<string, unknown>,
): Promise<string> {
  const query = String(args.query ?? args.q ?? '').trim();
  if (!query) {
    return '[工具错误] web-search 缺少参数 query';
  }
  const maxResults = Math.min(toInt(args, 'numResults', DEFAULT_MAX_RESULTS), 10);

  try {
    const results = await searchWithFallback(query, maxResults);
    if (results.length === 0) {
      return `未找到与「${query}」相关的搜索结果。`;
    }
    return results
      .map(
        (r, i) =>
          `${i + 1}. ${r.title}\n   链接: ${r.url}${
            r.snippet ? `\n   摘要: ${r.snippet}` : ''
          }`,
      )
      .join('\n\n');
  } catch (err) {
    const message = toErrorText(err);
    logger.warn(`web-search failed (query=${query}): ${message}`);
    return `[工具错误] web-search 搜索失败: ${message}（可配置 TAVILY_API_KEY 或 BRAVE_API_KEY 环境变量提升稳定性）`;
  }
}
