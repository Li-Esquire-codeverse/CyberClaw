import { Module } from '@nestjs/common';
import { ClawConfigService } from './claw-config.service';
import { AgentsController } from './agents.controller';

@Module({
  controllers: [AgentsController],
  providers: [ClawConfigService],
  exports: [ClawConfigService],
})
export class ClawModule {}
