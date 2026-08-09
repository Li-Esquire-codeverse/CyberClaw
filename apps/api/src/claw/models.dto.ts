import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** 创建 Model 的请求体 */
export class CreateModelDto {
  @IsString()
  @IsNotEmpty({ message: '请选择服务商' })
  provider!: string;

  @IsString()
  @IsNotEmpty({ message: '请输入配置名称' })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: '请输入模型名称' })
  model!: string;

  @IsString()
  @IsNotEmpty({ message: '请输入 Base URL' })
  baseUrl!: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/** 更新 Model 的请求体（全部可选） */
export class UpdateModelDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '配置名称不能为空' })
  name?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
