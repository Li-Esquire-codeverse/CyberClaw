import type { ToolDefinition } from './llm.js';
import type { Tool } from './tool.js';

/**
 * 工具注册表：按 name 管理工具集合。
 * 重复注册抛错，避免同名工具互相覆盖导致行为不可预期。
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  registerAll(tools: Tool[]): this {
    for (const tool of tools) this.register(tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  size(): number {
    return this.tools.size;
  }

  /** 转成 OpenAI 兼容的 function 声明列表（发给 LLM） */
  toDefinitions(): ToolDefinition[] {
    return this.list().map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters ?? { type: 'object', properties: {} },
      },
    }));
  }
}
