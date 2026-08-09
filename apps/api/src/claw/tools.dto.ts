import { Matches } from 'class-validator';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** 工具名：小写字母/数字开头，可含连字符 */
export const TOOL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** 创建 Tool 的请求体 */
export class CreateToolDto {
  @IsString()
  @IsNotEmpty({ message: '请输入工具名称' })
  @Matches(TOOL_NAME_PATTERN, {
    message: '工具名需为小写字母/数字开头，可含连字符（如 web-search）',
  })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: '请输入工具显示名' })
  label!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  builtin?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  icon?: string;
}

/** 更新 Tool 的请求体（全部可选） */
export class UpdateToolDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '工具名称不能为空' })
  @Matches(TOOL_NAME_PATTERN, {
    message: '工具名需为小写字母/数字开头，可含连字符（如 web-search）',
  })
  name?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  icon?: string;
}
