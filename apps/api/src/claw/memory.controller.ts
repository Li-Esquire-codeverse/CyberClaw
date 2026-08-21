import { Controller, Get, Inject } from '@nestjs/common';
import { MEMORY_STORE, defaultMemoryStore, type MemoryStore } from '../memory/memory.store';

/** 调试接口返回中单字段截断展示长度 */
const DISPLAY_LIMIT = 2000;

/**
 * 长期记忆调试接口（无鉴权，与 claw 模块现有接口一致）。
 *
 * GET /api/claw/memory
 * → { memory, user, stats }
 */
@Controller('claw/memory')
export class MemoryController {
  constructor(
    @Inject(MEMORY_STORE)
    private readonly memoryStore: MemoryStore = defaultMemoryStore,
  ) {}

  @Get()
  async getMemory(): Promise<{
    memory: string;
    user: string;
    stats: {
      memoryBytes: number;
      userBytes: number;
      journalCount: number;
      lastUpdated?: string;
    };
  }> {
    const [memory, user, stats] = await Promise.all([
      this.memoryStore.readMemory(),
      this.memoryStore.readUserProfile(),
      this.memoryStore.getStats(),
    ]);
    return {
      memory: memory.slice(0, DISPLAY_LIMIT),
      user: user.slice(0, DISPLAY_LIMIT),
      stats,
    };
  }
}
