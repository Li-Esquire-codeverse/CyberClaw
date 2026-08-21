import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ClawConfigService } from '../claw/claw-config.service';
import { ChatService } from '../chat/chat.service';
import { FeishuBotService } from '../channels/feishu/feishu.bot';
import { SseRenderer } from '../channels/feishu/feishu.renderer';
import { MEMORY_STORE, type MemoryStore } from '../memory/memory.store';
import {
  parseEverySeconds,
  type SchedulePayload,
  type ScheduleRecord,
  type ScheduleRun,
  type ScheduleStore,
} from './schedule.store';

/**
 * 调度执行器：at（一次性）+ every（固定间隔）。
 *
 * 任务来源：schedule.store（SQLite 持久化），启动时加载 enabled 任务注册定时器。
 * 执行 payload：agent-turn（buildAgent + streamChat 取最终文本），
 * 可 pushTo:'feishu' 推送结果到指定会话。
 *
 * 注意：进程内调度（依赖后端常驻）；at 执行后自动删除记录。
 */
export const SCHEDULE_STORE = Symbol('SCHEDULE_STORE');

/** 内置任务：journal 清理间隔（默认 7 天）与保留天数（默认 30 天） */
const PRUNE_INTERVAL = process.env.MEMORY_PRUNE_INTERVAL ?? '7d';
const PRUNE_RETENTION_DAYS = Number(process.env.MEMORY_PRUNE_RETENTION_DAYS ?? 30);

@Injectable()
export class ScheduleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduleService.name);
  private timers: { id: string; timer: NodeJS.Timeout }[] = [];

  constructor(
    @Inject(SCHEDULE_STORE) private readonly store: ScheduleStore,
    private readonly chatService: ChatService,
    private readonly configService: ClawConfigService,
    @Optional()
    private readonly feishuBot?: FeishuBotService,
    @Optional()
    @Inject(MEMORY_STORE)
    private readonly memoryStore?: MemoryStore,
  ) {}

  onModuleInit(): void {
    for (const rec of this.store.list()) {
      if (rec.enabled) this.register(rec);
    }
    this.registerBuiltinPrune();
  }

  onModuleDestroy(): void {
    for (const t of this.timers) {
      clearInterval(t.timer);
    }
    this.timers = [];
  }

  /** 注册（或刷新）一个任务的定时器 */
  register(rec: ScheduleRecord): void {
    this.unregister(rec.id);
    if (rec.type === 'every') {
      const secs = parseEverySeconds(rec.cron);
      if (secs === undefined) return;
      const timer = setInterval(() => void this.execute(rec), secs * 1000);
      timer.unref?.();
      this.timers.push({ id: rec.id, timer });
    } else {
      const delay = new Date(rec.cron).getTime() - Date.now();
      if (delay <= 0) return; // 已过期不注册
      const timer = setTimeout(async () => {
        this.unregister(rec.id);
        await this.execute(rec);
        // at 一次性：执行后删除记录
        this.store.remove(rec.id);
      }, delay);
      timer.unref?.();
      this.timers.push({ id: rec.id, timer });
    }
  }

  private unregister(id: string): void {
    const found = this.timers.find((t) => t.id === id);
    if (found) {
      clearInterval(found.timer);
      this.timers = this.timers.filter((t) => t.id !== id);
    }
  }

  /** 创建任务（持久化 + 注册定时器） */
  createTask(input: {
    type: 'at' | 'every';
    cron: string;
    payload: string;
  }): ScheduleRecord {
    const rec = this.store.create(input);
    if (rec.enabled) this.register(rec);
    return rec;
  }

  /** 删除任务（停用定时器 + 删记录） */
  removeTask(id: string): boolean {
    this.unregister(id);
    return this.store.remove(id);
  }

  /** 执行一次任务（记录运行历史） */
  async execute(rec: ScheduleRecord): Promise<ScheduleRun> {
    const run = this.store.recordRunStart(rec.id);
    try {
      const payload = JSON.parse(rec.payload) as SchedulePayload;
      const output = await this.runAgentTurn(payload);
      this.store.recordRunFinish(run.id, 'ok', output);
      return { ...run, status: 'ok', output, finishedAt: new Date().toISOString() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`调度任务执行失败 (${rec.id}): ${message}`);
      this.store.recordRunFinish(run.id, 'error', message);
      return { ...run, status: 'error', output: message, finishedAt: new Date().toISOString() };
    }
  }

  /**
   * agent-turn：让 agent 说一句话，返回最终文本。
   * 复用 buildAgent（记忆注入自动生效）+ streamChat（工具自动可用）。
   */
  async runAgentTurn(payload: SchedulePayload): Promise<string> {
    const agentId = payload.agentId?.trim() || this.defaultAgentId();
    if (!agentId) {
      throw new Error('没有可用的智能体，请先在配置中创建并启用');
    }
    const built = await this.chatService.buildAgent(agentId);
    const renderer = new SseRenderer();
    for await (const evt of this.chatService.streamChat(
      built,
      [{ role: 'user', content: payload.prompt }],
      undefined,
      `schedule:${built.agent.id}`,
    )) {
      renderer.ingest(evt);
    }
    const text = renderer.flush() ?? '';

    if (payload.pushTo === 'feishu' && payload.chatId && this.feishuBot) {
      await this.feishuBot.sendTextToChat(
        payload.chatId,
        text || '（任务执行完毕，无输出）',
      );
    }
    return text;
  }

  private defaultAgentId(): string | undefined {
    const config = this.configService.loadConfig();
    return config.agents.find((a) => a.enabled)?.id;
  }

  /**
   * 内置任务：定期清理过期 journal（Phase 2 记忆的维护任务）。
   * 默认每 7 天清理 30 天前的日记；环境变量可配。
   */
  private registerBuiltinPrune(): void {
    const secs = parseEverySeconds(PRUNE_INTERVAL);
    if (secs === undefined || !this.memoryStore) return;
    const timer = setInterval(() => {
      void this.memoryStore!
        .pruneJournal(PRUNE_RETENTION_DAYS)
        .then((removed) => {
          if (removed > 0) {
            this.logger.log(`journal 清理完成，删除 ${removed} 个过期文件`);
          }
        })
        .catch((err) => {
          this.logger.warn(`journal 清理失败: ${err instanceof Error ? err.message : err}`);
        });
    }, secs * 1000);
    timer.unref?.();
    this.timers.push({ id: '__builtin_prune__', timer });
  }
}
