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
 * 携带 conversationId（会话 ID）时，后端通过 langgraph checkpointer
 * 按 thread_id 持久化/恢复对话历史（对话记忆）；不携带时退化为单轮。
 */
export class ChatRequestDto {
  @IsOptional()
  @IsString()
  /** 智能体 id；缺省时由多 agent 路由按消息关键词分发（Phase 4） */
  agentId?: string;

  @IsOptional()
  @IsString()
  /** 会话 ID（thread_id）：同 ID 的请求共享对话历史 */
  conversationId?: string;

  @IsOptional()
  @IsBoolean()
  stream?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages?: ChatMessageDto[];
}
