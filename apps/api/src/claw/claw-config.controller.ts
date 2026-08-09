import { Body, Controller, Get, Post } from '@nestjs/common';
import { ClawConfigService } from './claw-config.service';
import type { CyberClawConfig } from './claw.types';
import { SaveConfigDto } from './save-config.dto';

/**
 * 全量配置读写接口（前端 webui 契约）
 *
 *  - GET  /api/claw/config  读取完整配置
 *  - POST /api/claw/config  保存完整配置
 *
 * 数据持久化在仓库根目录 CyberClaw.json。
 */
@Controller('claw/config')
export class ClawConfigController {
  constructor(private readonly configService: ClawConfigService) {}

  @Get()
  getConfig(): CyberClawConfig {
    return this.configService.loadConfig();
  }

  @Post()
  async saveConfig(@Body() config: SaveConfigDto): Promise<{ ok: true }> {
    await this.configService.saveConfig(config as CyberClawConfig);
    return { ok: true };
  }
}
