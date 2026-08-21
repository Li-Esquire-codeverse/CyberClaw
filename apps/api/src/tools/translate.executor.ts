import { Logger } from '@nestjs/common';

/**
 * translate 真实执行器
 *
 * 提供商策略（按环境变量优先级）：
 *   1. GOOGLE_TRANSLATE_ENDPOINT（自定义端点，默认 Google 免费端点，无需 key）
 *   2. 兜底 → MyMemory API（免费、无需 key，但不支持 auto 源语言，自动检测时按 en 处理）
 *
 * 支持的语言代码：zh-CN / zh-TW / en / ja / ko / fr / de / es / ru 等
 * （Google 端点支持语言自动检测 sl=auto）。
 */
const ENV_GOOGLE_ENDPOINT = 'GOOGLE_TRANSLATE_ENDPOINT';
/** 翻译提供商：google | mymemory | auto（默认 auto=先 Google 后 MyMemory；国内环境可设 mymemory 跳过 6s 等待） */
const ENV_TRANSLATE_PROVIDER = 'TRANSLATE_PROVIDER';
const DEFAULT_GOOGLE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';

const TRANSLATE_TIMEOUT_MS = 15_000;
/** Google 端点在国内通常不可达，用短超时快速 fallback 到 MyMemory */
const GOOGLE_TIMEOUT_MS = 6_000;
const MAX_TEXT_LEN = 2000;

const logger = new Logger('TranslateExecutor');

function toErrorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 语言代码归一化：空/undefined → 默认值 */
function langOf(args: Record<string, unknown>, key: string, fallback: string): string {
  const raw = String(args[key] ?? '').trim();
  return raw || fallback;
}

/** 调用 Google 免费翻译端点（client=gtx，无需 API key） */
async function googleTranslate(
  text: string,
  source: string,
  target: string,
): Promise<string> {
  const endpoint = process.env[ENV_GOOGLE_ENDPOINT] || DEFAULT_GOOGLE_ENDPOINT;
  const url =
    `${endpoint}?client=gtx&sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(
      target,
    )}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'CyberClaw/1.0' },
    // Google 端点在国内通常不可达，用短超时快速 fallback
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Google Translate 返回 ${res.status}`);
  }
  const data = (await res.json()) as unknown[][];
  // data[0] = [[译文片段, 原文片段, ...], ...]
  return (data[0] ?? [])
    .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
    .join('');
}

/** 兜底：MyMemory 翻译 API（免费；langpair 需具体语言，不支持 auto） */
async function myMemoryTranslate(
  text: string,
  source: string,
  target: string,
): Promise<string> {
  const src = source === 'auto' ? 'en' : source;
  const url =
    `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(
      src,
    )}|${encodeURIComponent(target)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'CyberClaw/1.0' },
    signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`MyMemory 返回 ${res.status}`);
  }
  const data = (await res.json()) as {
    responseData?: { translatedText?: string };
    responseStatus?: number;
    responseDetails?: string;
  };
  const translated = data.responseData?.translatedText?.trim();
  if (!translated) {
    throw new Error(
      `MyMemory 未返回译文（${data.responseDetails ?? data.responseStatus ?? '未知错误'}）`,
    );
  }
  return translated;
}

async function translateWithFallback(
  text: string,
  source: string,
  target: string,
): Promise<string> {
  const provider = (process.env[ENV_TRANSLATE_PROVIDER] ?? 'auto').toLowerCase();
  if (provider === 'mymemory') {
    return myMemoryTranslate(text, source, target);
  }
  try {
    return await googleTranslate(text, source, target);
  } catch (googleErr) {
    logger.warn(
      `google translate failed, falling back to MyMemory: ${toErrorText(googleErr)}`,
    );
    return myMemoryTranslate(text, source, target);
  }
}

/** translate 工具执行器（ToolExecutor 签名） */
export async function translateExecutor(
  args: Record<string, unknown>,
): Promise<string> {
  const text = String(args.text ?? args.content ?? '').trim();
  if (!text) {
    return '[工具错误] translate 缺少参数 text';
  }
  if (text.length > MAX_TEXT_LEN) {
    return `[工具错误] translate 单次最多翻译 ${MAX_TEXT_LEN} 字符，当前 ${text.length} 字符`;
  }
  const target = langOf(args, 'targetLang', 'zh-CN');
  const source = langOf(args, 'sourceLang', 'auto');

  try {
    return await translateWithFallback(text, source, target);
  } catch (err) {
    const message = toErrorText(err);
    logger.warn(`translate failed: ${message}`);
    return `[工具错误] translate 翻译失败: ${message}`;
  }
}
