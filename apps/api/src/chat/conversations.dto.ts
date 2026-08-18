import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** 创建/更新会话元数据 */
export class UpsertConversationDto {
  @IsString()
  @IsNotEmpty({ message: 'id is required' })
  id!: string;

  @IsString()
  @IsNotEmpty({ message: 'agentId is required' })
  agentId!: string;

  @IsOptional()
  @IsString()
  title?: string;
}
