# CyberClaw 🦞

> 从零构建的开源 AI 助手框架，灵感来自 [OpenClaw](https://openclaw.ai)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Node.js >= 20](https://img.shields.io/badge/Node.js-%3E%3D%2020-green)

---

## 📖 项目简介

CyberClaw 是一个**从零开发**（non-fork）的 AI 助手框架。目标是打造一个可自托管、可扩展的个人 AI 助手：用户通过 Web 界面管理**智能体（Agent）、大模型（Model）与工具（Tool）**，让 AI 助手能够调用工具完成真实任务。

当前版本聚焦于**管理端 WebUI** 的落地，核心运行时（LLM 客户端、工具系统、记忆、事件总线）正在规划中——详见 [Roadmap](#-roadmap)。

## ✨ 核心特性

### 已实现 ✅

- **智能体配置中心**（WebUI）：可视化管理多个 AI 智能体
  - 配置系统提示词（system prompt）、绑定大模型、勾选可用工具
- **大模型配置**：支持多 Provider（DeepSeek、OpenAI 等），自定义 `baseUrl` / `apiKey` / 模型名，可设置默认模型
- **工具管理**：内置工具注册与启停开关，为后续工具调用体系铺路
- **配置持久化**：REST API（`GET/POST /api/claw/config`）+ **localStorage 兜底**——后端未就绪时前端可独立运行，接入后端后无缝同步
- **TypeScript 全栈类型安全**：`Agent / Model / Tool` 配置模型前后端共享定义

### 规划中 🚧

- [ ] `packages/core`：LLM 客户端、工具调用系统、记忆（Memory）、事件总线（Event Bus）
- [ ] `packages/adapters`：消息平台适配器（Telegram / 飞书 / Discord …）
- [ ] `apps/cli`：命令行入口，无头模式运行
- [ ] 后端服务：持久化配置 API + 智能体执行引擎

## 🏗️ 项目结构

采用 **npm-workspaces Monorepo** 组织代码：

```
cyberclaw/
├── apps/                      # 可部署的应用
│   ├── webui/                 # ✅ 管理端 WebUI（React + Ant Design Pro）
│   │   └── src/pages/
│   │       ├── AgentsConfig/  #    智能体 / 大模型 / 工具 三大配置页
│   │       └── ...            #    看板、聊天、管理页等
│   └── cli/                   # 🚧 CLI 入口（规划中）
└── packages/                  # 可复用库
    ├── core/                  # 🚧 核心框架：LLM、工具、记忆、事件总线（规划中）
    └── adapters/              # 🚧 平台适配器（规划中）
```

## 🛠️ 技术栈

| 层 | 技术 |
|----|------|
| 前端 | TypeScript · React 18 · Ant Design · UmiJS Max |
| 工程化 | npm-workspaces · ESLint/Biome · Husky · Commitlint |
| 接口约定 | REST（`/api/claw/config`），配置格式对齐 `.imooc_claw/imooc_claw.json` |

## 📦 快速开始

环境要求：**Node.js ≥ 20**，npm ≥ 9

```bash
# 1. 安装依赖（monorepo 根目录）
npm install

# 2. 启动 WebUI
cd apps/webui
npm run dev
# 访问 http://localhost:8000
```

> 配置页会优先请求后端接口，当前后端未就绪时自动回退到浏览器本地存储，**无需后端即可体验完整配置流程**。

### 常用命令

```bash
npm run build       # 构建所有 workspace
npm run typecheck   # 全量类型检查
npm run lint        # 代码检查
```

## 🗺️ Roadmap

| 阶段 | 目标 |
|------|------|
| Phase 1（当前） | WebUI 配置中心：Agent / Model / Tool 可视化配置与持久化 |
| Phase 2 | `packages/core`：LLM 多 Provider 客户端、工具调用协议、简单记忆 |
| Phase 3 | 后端服务：配置 API 落地 + 智能体执行引擎 |
| Phase 4 | CLI 与消息平台适配器，让助手 7×24 运行 |

## 🤝 贡献

欢迎任何形式的贡献！项目遵循 **Git Flow 风格**分支管理：

- `main`：稳定版本
- `dev`：开发集成分支（日常开发基于此）

请遵循 [Conventional Commits](https://www.conventionalcommits.org/) 提交规范：

```
feat(webui): 新增 XX 功能
fix(core): 修复 XX 问题
chore: 更新依赖
```

提交前请确保通过 `npm run lint` 与 `npm run typecheck`。

## 📄 License

[MIT](LICENSE) © 2026 Li-Esquire-codeverse
