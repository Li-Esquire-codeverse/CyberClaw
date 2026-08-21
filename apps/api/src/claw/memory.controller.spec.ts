import { Test } from '@nestjs/testing';
import { MemoryController } from './memory.controller';
import { MEMORY_STORE, type MemoryStore } from '../memory/memory.store';

describe('MemoryController', () => {
  let controller: MemoryController;
  const store = {
    readMemory: jest.fn(async () => '- 2026-08-21 用户是一名律师\n'),
    readUserProfile: jest.fn(async () => '- 沟通风格：简洁\n'),
    getStats: jest.fn(async () => ({
      memoryBytes: 100,
      userBytes: 50,
      journalCount: 2,
      lastUpdated: '2026-08-21T00:00:00.000Z',
    })),
  } as unknown as MemoryStore;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MemoryController],
      providers: [{ provide: MEMORY_STORE, useValue: store }],
    }).compile();
    controller = moduleRef.get(MemoryController);
  });

  it('GET 返回记忆内容与统计', async () => {
    const result = await controller.getMemory();
    expect(result.memory).toContain('律师');
    expect(result.user).toContain('简洁');
    expect(result.stats.memoryBytes).toBe(100);
    expect(result.stats.journalCount).toBe(2);
    expect(result.stats.lastUpdated).toBeTruthy();
  });

  it('超长内容截断展示', async () => {
    (store.readMemory as jest.Mock).mockResolvedValueOnce('x'.repeat(5000));
    const result = await controller.getMemory();
    expect(result.memory.length).toBeLessThanOrEqual(2000);
  });
});
