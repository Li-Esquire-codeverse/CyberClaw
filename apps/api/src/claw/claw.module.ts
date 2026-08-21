import { Module } from '@nestjs/common';
import { ClawConfigService } from './claw-config.service';
import { AgentsController } from './agents.controller';
import { ClawConfigController } from './claw-config.controller';
import { ModelsController } from './models.controller';
import { ToolsController } from './tools.controller';

@Module({
  controllers: [
    AgentsController,
    ClawConfigController,
    ModelsController,
    ToolsController,
  ],
  providers: [ClawConfigService],
  exports: [ClawConfigService],
})
export class ClawModule {}
