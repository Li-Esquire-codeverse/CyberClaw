import { Injectable } from '@nestjs/common';
import { resolveAgentId, ResolveAgentIdInput } from './router';

/**
 * 路由服务：包装纯函数 resolveAgentId，供 ChatService / FeishuBotService 注入。
 *
 * 纯函数本身零依赖可直测（router.spec.ts）；Service 仅做 DI 桥接，
 * 使调用方可通过 @Optional 注入（未注册路由模块时优雅降级为原行为）。
 */
@Injectable()
export class RouterService {
  resolveAgentId(input: ResolveAgentIdInput): string | undefined {
    return resolveAgentId(input);
  }
}
