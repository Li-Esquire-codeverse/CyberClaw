/** 记忆模块共享类型 */

/** 追加结果 */
export interface AppendResult {
  ok: boolean;
  /** 本次写入的字节数（失败时 0） */
  bytes: number;
  /** 是否因超限被拒绝（ok=false）或单条超长被截断（ok=true） */
  truncated?: boolean;
  error?: string;
}

/** 检索命中项 */
export interface SearchHit {
  source: 'MEMORY' | 'USER' | 'journal';
  /** journal 条目的日期（YYYY-MM-DD）；MEMORY/USER 无 */
  date?: string;
  text: string;
  score: number;
}

/** 记忆统计（调试接口用） */
export interface MemoryStats {
  memoryBytes: number;
  userBytes: number;
  journalCount: number;
  lastUpdated?: string;
}
