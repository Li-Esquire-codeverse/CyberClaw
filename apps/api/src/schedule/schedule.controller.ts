import { Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { SCHEDULE_STORE, ScheduleService } from './schedule.service';
import type { ScheduleStore } from './schedule.store';

/**
 * 调度任务管理 API（本轮无 WebUI，API 独立可用）。
 *
 * GET    /api/claw/schedules          → 任务列表（含最近运行记录）
 * POST   /api/claw/schedules          → 创建 {type, cron, payload}
 * DELETE /api/claw/schedules/:id      → 删除
 */
@Controller('claw/schedules')
export class ScheduleController {
  constructor(
    private readonly service: ScheduleService,
    @Inject(SCHEDULE_STORE) private readonly store: ScheduleStore,
  ) {}

  @Get()
  list(): { id: string; type: string; cron: string; payload: unknown; enabled: boolean; lastRuns: unknown[] }[] {
    return this.store.list().map((s) => ({
      id: s.id,
      type: s.type,
      cron: s.cron,
      payload: safeParse(s.payload),
      enabled: s.enabled,
      lastRuns: this.store.listRuns(s.id, 5),
    }));
  }

  @Post()
  create(
    @Body() body: { type?: string; cron?: string; payload?: string | Record<string, unknown> },
  ): { id: string; type: string; cron: string; enabled: boolean } {
    const type = String(body.type ?? '').trim() as 'at' | 'every';
    const cron = String(body.cron ?? '').trim();
    // payload 允许传对象（自动序列化）或字符串
    const payload =
      typeof body.payload === 'string'
        ? body.payload
        : JSON.stringify(body.payload ?? {});
    try {
      const rec = this.service.createTask({ type, cron, payload });
      return { id: rec.id, type: rec.type, cron: rec.cron, enabled: rec.enabled };
    } catch (err) {
      throw new HttpException(
        { message: err instanceof Error ? err.message : String(err) },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string): { removed: boolean } {
    return { removed: this.service.removeTask(id) };
  }
}

function safeParse(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}
