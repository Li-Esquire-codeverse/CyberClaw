# CyberClaw 开发交接文档

> 本文档用于跨会话协作：每次开始新对话前，请 AI 先读本文件 + `README.md` + `git log`，即可无缝接续开发。
> 最后更新：2026-08-05

---

## 1. 项目速览

**CyberClaw** 🦞 — 从零构建（non-fork）的开源 AI 助手框架，灵感来自 OpenClaw。
目标：可自托管、可扩展的个人 AI 助手，通过 Web 界面管理智能体 / 大模型 / 工具。

**当前阶段：Phase 1（WebUI 配置中心已落地）**
- ✅ `apps/webui`：React + Ant Design Pro 管理端，含 Agents / Models / Tools 三大配置页
- ✅ 配置持久化：REST API + localStorage 兜底
- 🚧 `packages/core`、`packages/adapters`、`apps/cli`：占位，未开发
- 🚧 后端服务：未创建

## 2. 环境与访问（重要！）

| 项目 | 说明 |
|------|------|
| 仓库 | https://github.com/Li-Esquire-codeverse/CyberClaw |
| 远程 | `origin` = `git@github.com:Li-Esquire-codeverse/CyberClaw.git`（**SSH**，勿改回 HTTPS） |
| SSH 密钥 | `~/.ssh/id_ed25519`（已注册到 GitHub） |
| SSH 通道 | `~/.ssh/config` 已配置 `HostName ssh.github.com` + `Port 443`（**国内网络必须走这个**，github.com 直连/代理均不稳定） |
| 代理 | 本机 v2rayN（HTTP 10809 / SOCKS 10808）可能随时开关，git 全局配置里仍有 `http.proxy=127.0.0.1:10809`；**若代理未开导致失败，用 `git -c http.proxy= -c https.proxy=` 临时绕过**（但直连 github.com 也常超时，SSH 443 通道最稳） |
| git 全局凭据 | Windows 凭据管理器已存 GitHub token（有效期后需重新配置） |

## 3. 协作约定（务必遵守）

### 分支流程（Git Flow 风格）
```
feature/xxx  →  dev（日常开发集成分支）  →  main（稳定版，用 --no-ff merge）
```
- 日常开发全部在 `dev` 分支
- 稳定节点合并到 `main`：`git merge dev --no-ff -m "Merge branch 'dev': <摘要>"`
- **禁止直接 push main**

### 提交规范（Conventional Commits）
```
feat(scope): 新功能       例：feat(core): add LLM client with OpenAI provider
fix(scope):  修复         例：fix(webui): 修复模型列表删除后未刷新
docs:        文档         例：docs: update README
chore:       杂项         例：chore: add MIT LICENSE
```
scope 参考：`core` / `adapters` / `webui` / `cli` / `docs`

### 推送链路
```
git push origin dev    →   确认稳定后合并 main 再 push
```

## 4. 代码结构地图

```
apps/webui/src/
├── pages/
│   ├── AgentsConfig/          ← 核心业务页（本项目自研）
│   │   ├── Agents.tsx         # 智能体 CRUD
│   │   ├── Models.tsx         # 大模型配置（provider/baseUrl/apiKey/model）
│   │   ├── Tools.tsx          # 工具启停（8 个内置工具）
│   │   └── useConfig.ts       # 共享配置 Hook（useState + 双写持久化）
│   ├── chatbot/               # 聊天页（模板为基础，可改造）
│   ├── Welcome.tsx            # 已 rebrand
│   └── ...                    # 其余为 antd-pro 模板页面（dashboard/form/list 等）
├── services/cyberclaw/index.ts   ← 配置服务 + 类型定义（前后端契约！）
└── ...
packages/                      # 目前只有 .gitkeep
apps/cli/                      # 不存在，规划中
```

## 5. 配置接口契约（Phase 2 后端要实现）

### REST API
```
GET  /api/claw/config  →  CyberClawConfig
POST /api/claw/config  →  body: CyberClawConfig
```
前端行为：先请求后端，失败回退 `localStorage`（key: `cyberclaw.config`）；保存时双写。返回 `{ remote: boolean }` 提示来源。

### 配置结构（对应 `.imooc_claw/imooc_claw.json`）
```ts
interface CyberClawConfig {
  agents: ClawAgent[];  // { id, name, description?, systemPrompt?, modelId?, tools[], enabled, createdAt? }
  models:  ClawModel[]; // { id, provider, name(别名), model(如 deepseek-chat), baseUrl, apiKey, enabled, isDefault? }
  tools:   ClawTool[];  // { name, label, description, builtin, enabled, icon? }
}
```

### 内置工具清单（tools 初始值）
`web-search`、`browser`、`file-ops`、`shell`(默认关)、`memory`、`code-interpreter`、`image-gen`(默认关)、`translate`
→ **Phase 2 实现 core 工具系统时，这些就是第一批要真实落地的工具**

## 6. 明日开发计划（Phase 2：packages/core）

优先级排序，建议从 1 开始：

1. **LLM 多 Provider 客户端**（`packages/core/src/llm/`）
   - 接口设计：`LLMProvider`（OpenAI 兼容协议为先：DeepSeek/OpenAI/Ollama 都兼容）
   - 支持流式输出（SSE）
   - 类型安全：请求/响应模型
2. **工具调用协议**（`packages/core/src/tools/`）
   - `Tool` 接口（name/description/parameters schema/execute）
   - 注册表 + 前端 tools 配置联动
3. **Agent 运行时**：把 systemPrompt + modelId + tools 串起来的最小可运行循环
4. （可选）后端服务：实现 `/api/claw/config`，替换前端 localStorage 兜底

**设计建议**：
- 包内语言：TypeScript，ESM（根 package.json 已 `"type": "module"`）
- 命名遵循现有风格：配置名带 `Claw` 前缀（`ClawAgent`/`ClawModel`/`ClawTool`）
- 每个包自含 `package.json`（`@cyberclaw/core` 命名空间），再挂到根 workspaces

## 7. 技术决策记录（ADR 摘要）

| 决策 | 理由 |
|------|------|
| npm-workspaces monorepo | 前后端 + CLI + 核心库复用，面试加分 |
| WebUI 基于 antd-pro（非从零写 UI） | 快速出效果，精力投入核心业务 |
| 配置先 localStorage 兜底 | 后端未就绪时前端可独立演示 |
| SSH over 443 推送 | 国内网络唯一稳定通道 |
| MIT License | 开源最主流，面试友好 |

## 8. 安全备忘

- ⚠️ 对话中出现过的 GitHub token（`ghp_...`）**应已撤销**；若未撤销请撤销（Settings → Developer settings → Personal access tokens）
- `apiKey` 仅存在于用户配置数据中，注意后端存储时不得进 git（`.env` 已 gitignore）
- SSH 私钥 `~/.ssh/id_ed25519` 不要提交、不要外传

## 9. 明日会话开场白模板

> "继续开发 CyberClaw。先读 `docs/DEV-NOTES.md` 和 `README.md`，再看 `git log --oneline -10`。今天按 Phase 2 计划开发 `packages/core`，提交到 dev 分支。"
