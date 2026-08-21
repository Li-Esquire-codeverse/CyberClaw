import { Module } from '@nestjs/common';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { findRepoRoot } from '@cyberclaw/agent-core';
import { ChatModule } from '../chat/chat.module';
import { ClawModule } from '../claw/claw.module';
import { ChannelsModule } from '../channels/channels.module';
import { MemoryModule } from '../memory/memory.module';
import { SCHEDULE_STORE, ScheduleService } from './schedule.service';
import { ScheduleStore } from './schedule.store';
import { ScheduleController } from './schedule.controller';

const dbPathOf = (): string => {
  const root = findRepoRoot(process.cwd()) ?? process.cwd();
  return join(root, 'data', 'cyberclaw.db');
};

/**
 * 调度模块：at/every 定时任务（agent-turn 执行，可推送飞书）。
 * 无任务时零副作用；任务持久化在 SQLite schedules 表。
 */
@Module({
  imports: [ChatModule, ClawModule, ChannelsModule, MemoryModule],
  controllers: [ScheduleController],
  providers: [
    ScheduleService,
    {
      provide: SCHEDULE_STORE,
      useFactory: () => {
        const path = dbPathOf();
        if (!existsSync(dirname(path))) {
          mkdirSync(dirname(path), { recursive: true });
        }
        return new ScheduleStore(path);
      },
    },
  ],
})
export class ScheduleModule {}
