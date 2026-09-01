// src/pages/chatbot/data.d.ts

import type { ReactNode } from 'react';

export interface ConversationItem {
  key: string;
  /** 展示用标题（含来源 Tag 时为 ReactNode） */
  label: ReactNode;
  /** 纯文本标题（重命名/删除确认等需要字符串的场景使用） */
  rawTitle?: string;
  group?: string;
  isDraft?: boolean;
}

/** 工具调用记录（AI 助手气泡中展示 agent 正在调用/已完成的工具） */
export interface ToolCallInfo {
  /** 本会话内唯一标识（用于列表 key） */
  id: string;
  /** 工具名（对应 CyberClaw.json tools[].name） */
  tool: string;
  /** 模型传入的参数（JSON 字符串，可能为流式中途的部分参数） */
  args?: string;
  status: 'running' | 'success' | 'error';
  /** 工具执行结果（截断后的文本） */
  result?: string;
}

export type ParsedMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      thinkContent?: string;
      tools?: ToolCallInfo[];
    };
