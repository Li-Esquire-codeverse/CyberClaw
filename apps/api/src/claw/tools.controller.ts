import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { ClawConfigService } from './claw-config.service';
import type { ClawTool } from './claw.types';
import { CreateToolDto, UpdateToolDto } from './tools.dto';

/**
 * Tools 配置管理接口
 *
 * 配置持久化在仓库根目录 CyberClaw.json 的 `tools` key 下（工具以 name 为键）。
 *
 *  - GET    /api/claw/tools          列出全部 Tools
 *  - GET    /api/claw/tools/:name    查询单个 Tool
 *  - POST   /api/claw/tools          新建自定义 Tool
 *  - PUT    /api/claw/tools/:name    更新 Tool（内置工具不可重命名）
 *  - DELETE /api/claw/tools/:name    删除 Tool（内置工具或被 Agent 引用时返回 409）
 */
@Controller('claw/tools')
export class ToolsController {
  constructor(private readonly configService: ClawConfigService) {}

  @Get()
  list(): ClawTool[] {
    return this.configService.listTools();
  }

  @Get(':name')
  get(@Param('name') name: string): ClawTool {
    const tool = this.configService.getTool(name);
    if (!tool) {
      throw new NotFoundException(`Tool ${name} not found`);
    }
    return tool;
  }

  @Post()
  create(@Body() dto: CreateToolDto): Promise<ClawTool> {
    return this.configService.createTool(dto);
  }

  @Put(':name')
  update(@Param('name') name: string, @Body() dto: UpdateToolDto): Promise<ClawTool> {
    return this.configService.updateTool(name, dto);
  }

  @Delete(':name')
  async remove(@Param('name') name: string): Promise<{ ok: true }> {
    await this.configService.deleteTool(name);
    return { ok: true };
  }
}
