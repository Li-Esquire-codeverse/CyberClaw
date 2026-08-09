import { IsArray } from 'class-validator';

/**
 * 全量配置保存的请求体。
 *
 * 三个 key 必须都是数组；空对象 / 缺 key 会返回 400，
 * 防止误把配置清空成默认值（normalizeConfig 会补全缺失 key）。
 */
export class SaveConfigDto {
  @IsArray({ message: 'agents 必须是数组' })
  agents!: unknown[];

  @IsArray({ message: 'models 必须是数组' })
  models!: unknown[];

  @IsArray({ message: 'tools 必须是数组' })
  tools!: unknown[];
}
