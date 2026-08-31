import { Module } from '@nestjs/common';
import { RouterService } from './router.service';

/** 路由模块：多 agent 关键词分发（Phase 4 A）。导出 RouterService 供 Chat/Feishu 注入。 */
@Module({
  providers: [RouterService],
  exports: [RouterService],
})
export class RoutingModule {}
