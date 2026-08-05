# CyberClaw 🦞

An open-source AI assistant framework, inspired by [OpenClaw](https://openclaw.ai).

Built from scratch with an npm-workspaces monorepo.

## Monorepo structure

```
apps/        # Deployable applications
├── cli/     # CLI entry point
└── ...      # (future: server, etc.)

packages/    # Reusable libraries
├── core/      # Core framework: LLM client, tool system, memory, event bus
└── adapters/  # Messaging platform adapters (Telegram, etc.)
```

## Getting started

```bash
npm install
```

## Status

Under active development — see the roadmap in docs.
