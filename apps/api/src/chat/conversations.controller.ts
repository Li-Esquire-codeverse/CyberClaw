import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { UpsertConversationDto } from './conversations.dto';
import type { ConversationRecord } from './conversations.store';

/**
 * 会话列表管理接口（对话记忆的「列表层」）
 *
 *  - GET    /api/claw/conversations?agentId=  列出会话（按更新时间倒序）
 *  - POST   /api/claw/conversations           创建/更新会话元数据（标题、时间）
 *  - DELETE /api/claw/conversations/:id       删除会话（同时清理其线程记忆）
 *
 * 对话内容本身由 langgraph checkpointer 持久化（见 ChatService），
 * 本控制器只管理会话的列表元数据与删除联动。
 */
@Controller('claw/conversations')
export class ConversationsController {
  private readonly logger = new Logger(ConversationsController.name);

  constructor(private readonly chatService: ChatService) {}

  @Get()
  list(@Query('agentId') agentId?: string): ConversationRecord[] {
    return this.chatService.listConversations(agentId || undefined);
  }

  @Post()
  upsert(@Body() dto: UpsertConversationDto): ConversationRecord {
    return this.chatService.upsertConversation({
      id: dto.id,
      agentId: dto.agentId,
      title: dto.title?.trim() || '新对话',
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string): { ok: boolean } {
    const ok = this.chatService.removeConversation(id);
    if (!ok) {
      throw new NotFoundException(`会话不存在: ${id}`);
    }
    return { ok: true };
  }
}

/** 历史回显参数校验工具（chat controller 使用） */
export function requireConversationId(conversationId?: string): string {
  if (!conversationId || conversationId.trim() === '') {
    throw new BadRequestException('conversationId is required');
  }
  return conversationId;
}
