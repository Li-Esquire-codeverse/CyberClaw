import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/** 单条对话消息（与前端 chatbot 页面消息格式一致） */
export class ChatMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  content!: string;
}

/**
 * AI 助手对话请求
 *
 * 后端无状态：不保存会话，每次请求携带完整消息历史，
 * 由 langchain createAgent 基于 CyberClaw.json 中智能体的配置执行。
 */
export class ChatRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'agentId is required' })
  agentId!: string;

  @IsOptional()
  @IsBoolean()
  stream?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages?: ChatMessageDto[];
}
