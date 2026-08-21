import type { SearchHit } from './memory.types';

/**
 * 关键词检索纯函数（v1，无向量依赖）。
 *
 * 策略：
 *   1. 段落切分：Markdown 结构感知（空行分块 + 列表项逐项）
 *   2. 查询词提取：
 *      - 含 CJK → 整句 + 长度≥2 的连续片段（二元组近似语义）
 *      - 否则英文/数字按空白分词
 *   3. 打分：命中词数*3 + 命中片段总长/查询长度；全未命中得 0
 *   4. top-K（默认 5），score>0 才返回；英文大小写不敏感
 */

/** 检索输入条目 */
export interface SearchEntry {
  source: SearchHit['source'];
  date?: string;
  text: string;
}

const MAX_QUERY_LEN = 200;
const MAX_PARAGRAPH_DISPLAY = 2000;

/** 是否包含 CJK（中日韩）字符 */
function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

/** 提取查询词 */
function extractTerms(query: string): string[] {
  const q = query.slice(0, MAX_QUERY_LEN);
  if (hasCjk(q)) {
    const terms = new Set<string>();
    terms.add(q);
    // 连续中文片段内取长度≥2 的滑动窗口（二元组近似）
    const runs = q.match(/[\u4e00-\u9fff]+/g) ?? [];
    for (const run of runs) {
      if (run.length >= 3) {
        for (let i = 0; i <= run.length - 2; i++) {
          terms.add(run.slice(i, i + 2));
        }
      }
    }
    return [...terms];
  }
  // 英文/数字：小写分词，忽略大小写
  return q.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
}

/** Markdown 结构感知的段落切分 */
export function splitParagraphs(text: string): string[] {
  const out: string[] = [];
  const blocks = text.split(/\n\s*\n/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    // 列表块：逐项切分（- / * 开头）
    if (/^[-*]\s/m.test(trimmed)) {
      const items = trimmed.split(/\n(?=[-*]\s)/).map((s) => s.trim());
      out.push(...items.filter(Boolean));
    } else {
      out.push(trimmed);
    }
  }
  return out;
}

/** 段落打分：命中词数加权 + 命中长度占比 */
function scoreParagraph(para: string, terms: string[]): number {
  const lower = para.toLowerCase();
  let matched = 0;
  let matchedLen = 0;
  for (const term of terms) {
    if (lower.includes(term.toLowerCase())) {
      matched++;
      matchedLen += term.length;
    }
  }
  if (matched === 0) return 0;
  const queryLen = Math.max(1, terms.join('').length);
  return matched * 3 + matchedLen / queryLen;
}

function truncatePara(text: string): string {
  if (text.length <= MAX_PARAGRAPH_DISPLAY) return text;
  return `${text.slice(0, MAX_PARAGRAPH_DISPLAY)}…`;
}

/**
 * 对多个来源条目做关键词检索，返回按分数降序的 top-K 命中。
 * 空 query / 无命中 → 空数组（不抛错）。
 */
export function searchTexts(
  entries: SearchEntry[],
  query: string,
  limit = 5,
): SearchHit[] {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const terms = extractTerms(q);
  if (terms.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const entry of entries) {
    const paragraphs = splitParagraphs(entry.text);
    for (const para of paragraphs) {
      const score = scoreParagraph(para, terms);
      if (score > 0) {
        hits.push({
          source: entry.source,
          date: entry.date,
          text: truncatePara(para),
          score,
        });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
