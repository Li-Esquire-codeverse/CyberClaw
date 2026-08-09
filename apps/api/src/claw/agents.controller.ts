import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { ClawConfigService } from './claw-config.service';
import type { ClawAgent } from './claw.types';
import { CreateAgentDto, UpdateAgentDto } from './agents.dto';

/**
 * Agents 配置管理接口
 *
 * 所有配置持久化在仓库根目录 CyberClaw.json 的 `agents` key 下。
 *
 *  - GET    /api/claw/agents        列出全部 Agents
 *  - GET    /api/claw/agents/:id    查询单个 Agent
 *  - POST   /api/claw/agents        新建 Agent
 *  - PUT    /api/claw/agents/:id    更新 Agent
 *  - DELETE /api/claw/agents/:id    删除 Agent
 */
@Controller('claw/agents')
export class AgentsController {
  constructor(private readonly configService: ClawConfigService) {}

  @Get()
  list(): ClawAgent[] {
    return this.configService.listAgents();
  }

  @Get(':id')
  get(@Param('id') id: string): ClawAgent {
    const agent = this.configService.getAgent(id);
    if (!agent) {
      throw new NotFoundException(`Agent ${id} not found`);
    }
    return agent;
  }

  @Post()
  create(@Body() dto: CreateAgentDto): Promise<ClawAgent> {
    return this.configService.createAgent(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAgentDto): Promise<ClawAgent> {
    return this.configService.updateAgent(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    await this.configService.deleteAgent(id);
    return { ok: true };
  }
}
