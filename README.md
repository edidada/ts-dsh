# ts-dsh

> **TypeScript 教学级复刻：DeepSeek Harness (`dsh`) 的插件化 Agent 运行时**

本项目以 [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)（npm 包名 `@deepseek-ai/dsh`，CLI 简称 `dsh`）为参照，用 TypeScript 从零实现一个**架构同构、规模可控**的 Agent Harness 复刻版。它不是一个"聊天命令行工具"，而是复刻 `dsh` 那套 **"Agent = Model + Harness"**、**"Everything is a Plugin"** 的运行时骨架。

上游核心思想：`dsh` 基于 [Cordis](https://github.com/cordiverse/cordis) 的时空可组合性（spatiotemporal composability），把模型适配器、工具注册表、会话日志、Agent 主循环本身都做成可替换的插件；一次运行 = `Profile → Bundle → Patch` 分层配置组合出的一棵插件树；会话是 append-only 事件日志，`deriveMessages()` 从中投影出模型可见历史。

## 它实现了什么

- **插件宿主**：`Context` 注册服务到 `ctx.<key>`，所有注册都是**可逆副作用**（插件卸载即回滚），事件总线支持 serial / waterfall 分发。
- **分层配置**：内置 `dsh-base`、`dsh-headless`、`dsh-web-app`、`dsh-tui`、`dsh-sdk-app`、`dsh-acp-app`、`dsh-sdk-minimal` 等 bundle，以及 `web / headless / tui / sdk / sdk-minimal / acp` profile。`--patch` 可叠加覆盖，`--dump-config` 可打印组合结果。
- **会话日志**：append-only `SessionEvent` JSONL，支持 replay / `deriveMessages` / fork / resume / search / stat / list。
- **模型接缝**：`ctx.llm` 适配器注册表，含 SSE 流式解析的 DeepSeek（OpenAI 兼容）适配器与确定性 Mock 适配器；**未配置 API Key 时自动回退 Mock**，因此离线与 CI 可运行。
- **工具流水线**：作用域工具注册表（global / scoped 影子覆盖）、`pre-execute → execute → post-execute` 受控流水线、权限预设与 `ask / never` 审批策略。
- **Agent 主循环**：`turn = 0..n step`，每个 step = 一次模型请求 + 其触发的工具调用；模型可见事实全部落盘（`Model-visible means logged`）。
- **人工命令**：`ctx.commands` 斜杠命令，不进入模型消息。
- **多种运行形态**：`headless`（一次性任务，`--json` 输出 NDJSON）、`tui`（REPL）、`web`（HTTP 服务，默认 3080）、`sdk`（stdio JSON-RPC）、`acp`（自动化占位）。

## 快速开始

```bash
# 需要 Node.js >= 22.18
npm ci
npm run build

# 打印版本与帮助
node dist/cli.js --version
node dist/cli.js --help

# 查看某个 profile 组合出的插件树（不启动应用）
node dist/cli.js --profile web --dump-config

# 一次性任务：无 API Key 时走 Mock，可直接离线跑
node dist/cli.js --profile headless "总结一下这个仓库"
node dist/cli.js --profile headless --json "列出当前目录" > events.ndjson

# 交互式 TUI
node dist/cli.js tui

# Web UI（默认 http://127.0.0.1:3080）
node dist/cli.js web --no-open
```

配置真实模型：

```bash
export DEEPSEEK_API_KEY=sk-xxxxxxxx
export DSH_MODEL=deepseek-chat          # 可选
node dist/cli.js --profile headless "帮我看看 src/cli.ts"
```

全局安装后可直接用 `dsh`：

```bash
npm run build && npm install -g .
dsh --profile headless "run the tests"
```

会话与配置落在 `$DSH_HOME`（默认 `~/.dsh`）：`profiles/<name>/profile.json` 是自定义 profile，
`sessions/<id>/session.vN.jsonl` 是 append-only 事件日志，`--session-id` 可续跑，`dsh plugin` 可管理外挂插件。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 空 | 有值时使用 DeepSeek 适配器，否则回退 Mock |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | OpenAI 兼容端点 |
| `DSH_MODEL` | `deepseek-chat` | 模型名 |
| `DSH_MODEL_ADAPTER` | 自动 | 强制指定 `deepseek` / `mock` |
| `DSH_HOME` | `~/.dsh` | profile、会话、配置的数据目录 |
| `DSH_MAX_STEPS` | `8` | 单个 turn 的最大 step 数 |

## 开发

```bash
npm run build      # tsc -> dist/
npm test           # node --test test/*.test.mjs（跑 dist 产物）
npm run typecheck  # tsc --noEmit
```

> 本项目按约定**不在本地跑构建与测试**，以推送后 GitHub Actions 的执行日志作为唯一验证与修复回路，详见 `docs/07-test-plan.md`。

## 交付状态

- 仓库：[github.com/edidada/ts-dsh](https://github.com/edidada/ts-dsh)，分支 `main`，按「一个功能一个 conventional commit + push」推进。
- CI：`.github/workflows/ci.yml`，Node 22 / 24 矩阵，`npm ci → build → typecheck → test → 8 项 smoke`，全部 `success`。
- 测试：`node --test test/*.test.mjs` 共 **69 个用例全通过**（core / config / session / llm / tools / agent / commands / cli / web）。
- 里程碑 M0–M9 全部完成；期间按 GitHub Actions 日志修复了 4 轮报错（配置 insert 语义与 hint、restrict 断言、首事件断言、TS2783 重复字段）。
- 离线可跑：无 `DEEPSEEK_API_KEY` 时自动回退 Mock 适配器，CI 与本地均无需密钥。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/01-architecture.md](docs/01-architecture.md) | 架构设计 |
| [docs/02-features.md](docs/02-features.md) | 功能列表 |
| [docs/03-high-level-design.md](docs/03-high-level-design.md) | 概要设计 |
| [docs/04-milestones.md](docs/04-milestones.md) | 里程碑节点 |
| [docs/05-tech-stack.md](docs/05-tech-stack.md) | 技术选型 |
| [docs/06-performance.md](docs/06-performance.md) | 目标性能指标 |
| [docs/07-test-plan.md](docs/07-test-plan.md) | 测试计划 |

## 与上游的关系

这是**独立实现的教学级复刻**，非官方项目、非 fork，不含上游任何源码。为了零依赖与可测试性做了明确简化（JSON patch 代替 YAML、去掉 Electron/浏览器客户端、去掉 Cordis 完整依赖注入实现等），取舍详见 `docs/01-architecture.md` 第 10 节。

上游仓库：https://github.com/deepseek-ai/deepseek-harness ｜ License: MIT
