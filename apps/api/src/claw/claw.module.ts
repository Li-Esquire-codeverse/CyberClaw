import { Module } from '@nestjs/common';
import { ClawConfigService } from './claw-config.service';
import { AgentsController } from './agents.controller';
import { ClawConfigController } from './claw-config.controller';

@Module({
  controllers: [AgentsController, ClawConfigController],
  providers: [ClawConfigService],
  exports: [ClawConfigService],
})
export class ClawModule {}
