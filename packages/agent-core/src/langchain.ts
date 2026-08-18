import { ChatOpenAI } from '@langchain/openai';
import { createAgent, type CreateAgentParams } from 'langchain';
import { DynamicStructuredTool } from '@langchain/core/tools';
import type { DynamicStructuredToolInput, StructuredToolInterface } from '@langchain/core/tools';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';

/** 对话记忆存储类型：透传 langgraph checkpointer（MemorySaver / SqliteSaver 等）
 *  由 agent-core 统一导出，避免消费方（CJS）与 ESM 双包类型冲突。 */
export type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import {
  type AgentRuntimeConfig,
  type ClawConfigFile,
  type ClawModel,
  type ClawTool,
  getEnabledModels,
  getEnabledTools,
  loadConfig,
} from './config.js';

/**
 * 内置工具执行器签名：args 为模型传入的 JSON 参数，返回回填给模型的文本。
 */
export type ToolExecutor = (args: Record<string, unknown>) => Promise<string>;

/**
 * 内置 8 工具的执行器注册表（web-search / browser / file-ops / shell /
 * memory / code-interpreter / image-gen / translate）。
 *
 * 默认均为「未实现」占位——工具本身依赖外部服务（搜索、浏览器、代码执行等），
 * 由上层通过 createLangchainAgent 的 toolExecutors 参数注入真实实现。
 * 未注册的工具被调用时会返回清晰错误，不会中断 agent。
 */
export const BUILTIN_TOOL_EXECUTORS: Record<string, ToolExecutor> = {};

export interface CreateLangchainAgentOptions {
  /** 已加载的配置（与 configFile 二选一） */
  config?: ClawConfigFile;
  /** 配置文件路径（自动加载，支持 env/仓库根查找） */
  configFile?: string;
  /** 向上查找仓库根的起始目录 */
  cwd?: string;
  /** 指定模型 id；默认取 isDefault，其次第一个启用模型 */
  modelId?: string;
  /** 系统提示词；默认取配置中第一个启用智能体的 systemPrompt，否则用内置默认 */
  systemPrompt?: string;
  /** 工具执行器覆盖（name -> 实现），可为内置工具注入真实逻辑 */
  toolExecutors?: Record<string, ToolExecutor>;
  /** 追加的自定义 langchain 工具 */
  extraTools?: StructuredToolInterface[];
  /** 自定义 LLM 工厂（默认用 ChatOpenAI 对接 baseUrl；测试可注入 fake 模型） */
  llmFactory?: (model: ClawModel) => BaseChatModel;
  /**
   * langgraph checkpointer：启用后按 thread_id 持久化会话历史（对话记忆）。
   * 传 BaseCheckpointSaver（MemorySaver / SqliteSaver）或 true（langgraph 默认 saver）。
   */
  checkpointer?: BaseCheckpointSaver | boolean;
  /** 透传给 createAgent 的额外参数 */
  agentOptions?: Omit<CreateAgentParams, 'model' | 'tools' | 'systemPrompt'>;
}

export interface CreatedLangchainAgent {
  /** 编译后的 agent（langgraph ReactAgent，由 createAgent 生成） */
  agent: ReturnType<typeof createAgent>;
  /** 实际选用的模型配置 */
  model: ClawModel;
  /** langchain chat model 实例 */
  chatModel: BaseChatModel;
  /** 注册到 agent 的 langchain 工具 */
  tools: StructuredToolInterface[];
  /** 本次使用的配置 */
  config: ClawConfigFile;
}

const DEFAULT_SYSTEM_PROMPT =
  '你是 CyberClaw 智能体。请根据用户问题思考是否调用可用工具，再给出简洁准确的回答。';

/**
 * 从模型配置构造 ChatOpenAI（OpenAI 兼容协议：DeepSeek / Qwen / Ollama / 自定义端点均适用）。
 */
export function createChatModelFromConfig(
  model: ClawModel,
  factory?: (m: ClawModel) => BaseChatModel,
): BaseChatModel {
  if (factory) return factory(model);
  return new ChatOpenAI({
    model: model.model,
    apiKey: model.apiKey || 'sk-local-placeholder',
    temperature: 0,
    configuration: {
      baseURL: model.baseUrl,
    },
  });
}

/**
 * 将配置中的 ClawTool 包装为 langchain DynamicStructuredTool。
 * 执行逻辑：toolExecutors[name]（或内置注册表）→ 无实现返回清晰错误。
 */
export function toLangchainTool(
  tool: ClawTool,
  executor: ToolExecutor | undefined,
): StructuredToolInterface {
  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description || tool.label,
    schema: (tool.parameters ?? {
      type: 'object',
      properties: {},
    }) as DynamicStructuredToolInput<Record<string, unknown>>['schema'],
    func: async (input: Record<string, unknown>) => {
      if (!executor) {
        return `[工具未实现] 工具 "${tool.name}" 的执行器尚未注册，请通过 toolExecutors 注入`;
      }
      return executor(input);
    },
  });
}

/**
 * 使用 langchain + 配置文件中的模型/工具配置创建 agent（默认 tool-calling 策略）。
 *
 * 用法：
 *   const { agent } = await createLangchainAgent({
 *     configFile: 'path/to/CyberClaw.json',  // 或省略自动加载
 *     toolExecutors: { 'web-search': searchImpl },
 *   });
 *   const res = await agent.invoke({ messages: [{ role: 'user', content: '你好' }] });
 */
export async function createLangchainAgent(
  options: CreateLangchainAgentOptions = {},
): Promise<CreatedLangchainAgent> {
  const config = options.config ?? loadConfig({ configFile: options.configFile, cwd: options.cwd });

  const enabledModels = getEnabledModels(config);
  if (enabledModels.length === 0) {
    throw new Error(
      '配置中没有启用的模型：请在 CyberClaw.json 中配置 models 并设置 enabled: true',
    );
  }
  const model =
    (options.modelId && enabledModels.find((m) => m.id === options.modelId)) ||
    enabledModels.find((m) => m.isDefault) ||
    enabledModels[0]!;

  const chatModel = createChatModelFromConfig(model, options.llmFactory);

  const enabledTools = getEnabledTools(config);
  const tools: StructuredToolInterface[] = enabledTools.map((t) =>
    toLangchainTool(t, options.toolExecutors?.[t.name] ?? BUILTIN_TOOL_EXECUTORS[t.name]),
  );
  if (options.extraTools) tools.push(...options.extraTools);

  // 系统提示词：显式指定 > 配置中第一个启用智能体 > 内置默认
  const enabledAgent = config.agents.find((a) => a.enabled);
  const systemPrompt =
    options.systemPrompt ??
    enabledAgent?.systemPrompt?.trim() ??
    DEFAULT_SYSTEM_PROMPT;
  

  const agent = createAgent({
    model: chatModel,
    tools,
    systemPrompt,
    ...(options.checkpointer !== undefined
      ? { checkpointer: options.checkpointer }
      : {}),
    ...options.agentOptions,
  });

  return { agent, model, chatModel, tools, config };
}

/** 便捷方法：直接读取启用配置并创建 agent */
export async function createLangchainAgentFromConfig(
  runtime: AgentRuntimeConfig,
  options: Omit<CreateLangchainAgentOptions, 'config'> = {},
): Promise<CreatedLangchainAgent> {
  return createLangchainAgent({
    ...options,
    config: { agents: [], models: runtime.models, tools: runtime.tools },
  });
}
