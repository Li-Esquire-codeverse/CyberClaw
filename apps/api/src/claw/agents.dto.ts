import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

/** 创建 Agent 的请求体 */
export class CreateAgentDto {
  @IsString()
  @IsNotEmpty({ message: 'Agent name is required' })
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tools?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** 更新 Agent 的请求体（全部可选，只更新传入字段） */
export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Agent name cannot be empty' })
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tools?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
