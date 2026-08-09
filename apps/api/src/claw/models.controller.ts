import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { ClawConfigService } from './claw-config.service';
import type { ClawModel } from './claw.types';
import { CreateModelDto, UpdateModelDto } from './models.dto';

/**
 * Models 配置管理接口
 *
 * 配置持久化在仓库根目录 CyberClaw.json 的 `models` key 下。
 *
 *  - GET    /api/claw/models        列出全部 Models
 *  - GET    /api/claw/models/:id    查询单个 Model
 *  - POST   /api/claw/models        新建 Model（第一个自动设为默认）
 *  - PUT    /api/claw/models/:id    更新 Model（设为默认时清除其他默认标记）
 *  - DELETE /api/claw/models/:id    删除 Model（被 Agent 引用时返回 409）
 */
@Controller('claw/models')
export class ModelsController {
  constructor(private readonly configService: ClawConfigService) {}

  @Get()
  list(): ClawModel[] {
    return this.configService.listModels();
  }

  @Get(':id')
  get(@Param('id') id: string): ClawModel {
    const model = this.configService.getModel(id);
    if (!model) {
      throw new NotFoundException(`Model ${id} not found`);
    }
    return model;
  }

  @Post()
  create(@Body() dto: CreateModelDto): Promise<ClawModel> {
    return this.configService.createModel(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateModelDto): Promise<ClawModel> {
    return this.configService.updateModel(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    await this.configService.deleteModel(id);
    return { ok: true };
  }
}
