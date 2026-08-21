import { Module } from '@nestjs/common';
import { MEMORY_STORE, defaultMemoryStore } from './memory.store';
import { MemoryController } from '../claw/memory.controller';

/**
 * 长期记忆模块：提供全局共享的 MemoryStore 单例（写队列统一），
 * 并暴露调试接口 GET /api/claw/memory。
 *
 * 消费方：
 *   - ChatService（注入读，systemPrompt 注入）
 *   - memory 工具执行器（写入/检索，经 CHAT_TOOL_EXECUTORS 工厂引用 defaultMemoryStore）
 */
@Module({
  controllers: [MemoryController],
  providers: [{ provide: MEMORY_STORE, useValue: defaultMemoryStore }],
  exports: [MEMORY_STORE],
})
export class MemoryModule {}
