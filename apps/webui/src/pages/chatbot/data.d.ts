// src/pages/chatbot/data.d.ts

export interface ConversationItem {
  key: string;
  label: string;
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
