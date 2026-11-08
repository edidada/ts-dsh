# 02 · 功能列表

> 状态：`✅ 已实现` / `🚧 部分实现` / `⬜ 明确不做`。里程碑编号见 `04-milestones.md`。

## F1 插件宿主与运行时内核（M2）

| ID | 功能 | 状态 |
| --- | --- | --- |
| F1.1 | `Context` 服务注册表：`provide / get / peek` | ✅ |
| F1.2 | 可逆副作用：`onDispose` + 逆序 `dispose()` 回滚 | ✅ |
| F1.3 | 插件 `mount / unmount`，卸载即清除其全部注册 | ✅ |
| F1.4 | `waitFor` 依赖等待与 `service/added / removed` 通知 | ✅ |
| F1.5 | EventBus：`serial`（无 next）与 `waterfall`（必须 next）两种分发 | ✅ |
| F1.6 | 作用域：`scoped()`、global/scoped 影子覆盖、`restrict` 交集过滤 | ✅ |
| F1.7 | Cordis 完整 DI / HMR 热重载 | ⬜ |

## F2 分层配置（M3）

| ID | 功能 | 状态 |
| --- | --- | --- |
| F2.1 | `ConfigRow`（id / use / config / enabled）与 `PatchOp` 数据模型 | ✅ |
| F2.2 | 内置 bundle：`dsh-base`、`dsh-headless`、`dsh-tui`、`dsh-web-app`、`dsh-sdk-app`、`dsh-acp-app`、`dsh-sdk-minimal` | ✅ |
| F2.3 | 内置 profile：`web / headless / tui / sdk / sdk-minimal / acp` | ✅ |
| F2.4 | 分层组合：bundles → profile patch → home patch → `--patch`（可重复） | ✅ |
| F2.5 | patch 操作：`replace / insert(before\|after) / remove`，按 id 整体替换 | ✅ |
| F2.6 | `--dump-config` 打印组合树 | ✅ |
| F2.7 | `--dump-default-config` 跳过用户层 | ✅ |
| F2.8 | `--dump-config-schema` 输出 JSON Schema | ✅ |
| F2.9 | `--from-default-profile <name>` 从模板重建自定义 profile | ✅ |
| F2.10 | `preset` patch / YAML patch / HMR 配置层 | ⬜（用 JSON patch 代替） |

## F3 会话事件日志（M4）

| ID | 功能 | 状态 |
| --- | --- | --- |
| F3.1 | `SessionEvent` 持久事件联合类型（turn/step/message/tool/request） | ✅ |
| F3.2 | append-only 追加，单调 `seq` + 时间戳 | ✅ |
| F3.3 | JSONL 物理帧写入与代际文件（`session.v1.jsonl`） | ✅ |
| F3.4 | 容忍被截断的尾行；`stat / list` 头信息扫描 | ✅ |
| F3.5 | `replay()` 重放，重建 turn/step/open 状态 | ✅ |
| F3.6 | `deriveMessages()` 投影模型可见历史 | ✅ |
| F3.7 | `fork(atSeq)` 在边界分叉出新会话 | ✅ |
| F3.8 | `resume(sessionId)` / `--session-id` 续跑 | ✅ |
| F3.9 | `search(query)` 全文检索事件 | ✅ |
| F3.10 | `assistant/attempt` 记录失败/重试/取消且不入模型历史 | ✅ |
| F3.11 | zstd 压缩、vN→vN+1 迁移链、独占发布 | ⬜ |

## F4 模型适配层（M5）

| ID | 功能 | 状态 |
| --- | --- | --- |
| F4.1 | `Message` / `StreamChunk` / `ModelAdapter` 词汇与接缝 | ✅ |
| F4.2 | `ctx.llm` 适配器注册表：`register / get / list / resolve` | ✅ |
| F4.3 | SSE 解析器：`data:` 帧、`[DONE]`、跨 chunk 缓冲、tool_call delta 按 index 聚合 | ✅ |
| F4.4 | DeepSeek（OpenAI 兼容 `/chat/completions`）流式适配器 | ✅ |
| F4.5 | `fetch` 可注入，便于离线单测 | ✅ |
| F4.6 | AbortSignal 取消透传 | ✅ |
| F4.7 | 确定性 Mock 适配器（可编排 tool_call → 最终回答） | ✅ |
| F4.8 | 无 `DEEPSEEK_API_KEY` 自动回退 Mock（CI 离线可跑） | ✅ |
| F4.9 | `usage` / reasoning_content / 多模态附件 | 🚧（仅 usage 简单透传） |

## F5 工具与审批（M6）

| ID | 功能 | 状态 |
| --- | --- | --- |
| F5.1 | `ctx.tools` 作用域注册表：`register / list / restrict` | ✅ |
| F5.2 | 工具 JSON Schema 加入 prompt 装配 | ✅ |
| F5.3 | `pre-execute → execute → post-execute` waterfall 流水线 | ✅ |
| F5.4 | 并发限制与超时保护 | ✅ |
| F5.5 | 权限预设：`read-only / workspace-write / full-access` | ✅ |
| F5.6 | 审批策略：`ask / never`，`--approval-policy` 覆盖 | ✅ |
| F5.7 | 内置工具：`read_file`、`write_file`、`list_dir`、`run_command`、`echo`、`now` | ✅ |
| F5.8 | 工作区写根限制、`--add-dir` 附加目录 | ✅ |
| F5.9 | 未知工具 / 被过滤工具给出与"不存在"不可区分的拒绝 | ✅ |
| F5.10 | 沙箱后端 / PTY 终端 / LSP / MCP 工具 | ⬜ |

## F6 Agent 主循环（M7）

| ID | 功能 | 状态 |
| --- | --- | --- |
| F6.1 | `ctx.systemPrompt` 分段与工具 schema 装配 | ✅ |
| F6.2 | `ctx.agents` 活 Agent 注册表与 `agent/created` | ✅ |
| F6.3 | `ctx.agentLoop` 默认驱动：turn = 0..n step | ✅ |
| F6.4 | durable 事件落盘 + live 事件发射（供 `--json`） | ✅ |
| F6.5 | `agent/pre-step`、`agent/request`、`agent/turn-stopping` 扩展点 | ✅ |
| F6.6 | `maxSteps` 上限、`AbortSignal` 取消、失败 step 记录缺失 tool result | ✅ |
| F6.7 | 子 Agent / 团队 / Goal / Ralph 循环 / 调度器 | ⬜ |

## F7 人工命令（M8）

| ID | 功能 | 状态 |
| --- | --- | --- |
| F7.1 | `ctx.commands` 斜杠命令注册与分发，不进入模型消息 | ✅ |
| F7.2 | 内置：`/help`、`/model`、`/session`、`/clear`、`/quit`、`/dump-config` | ✅ |
| F7.3 | `/goal`、`/compact` 等命令插件生态 | ⬜ |

## F8 应用形态与 CLI（M8）

| ID | 功能 | 状态 |
| --- | --- | --- |
| F8.1 | `dsh` 启动器：`--profile`、`--version`、`--help` | ✅ |
| F8.2 | `headless`：一次性任务、stdin(`-`)、`--json` NDJSON、`--session-id`、权限参数 | ✅ |
| F8.3 | `tui`：readline REPL + 斜杠命令 + 流式渲染 | ✅ |
| F8.4 | `web`：HTTP 服务（默认 3080）、`/api/health`、`/api/config`、`/api/run`、`/api/sessions`、静态页 | ✅ |
| F8.5 | `sdk`：stdio JSON-RPC（`initialize / session.create / session.run`） | ✅ |
| F8.6 | `acp`：自动化运行形态占位 | ✅ |
| F8.7 | `dsh plugin --profile <name> add/remove/list/why` 管理 profile 插件 | ✅ |
| F8.8 | Electron 桌面端、完整浏览器客户端、Python SDK | ⬜ |

## F9 工程质量（M1）

| ID | 功能 | 状态 |
| --- | --- | --- |
| F9.1 | 零运行时依赖，仅 `typescript` + `@types/node` 开发依赖 | ✅ |
| F9.2 | ESM + `dist/cli.js` 可执行入口（`bin: dsh`） | ✅ |
| F9.3 | GitHub Actions CI：Node 22/24 矩阵，`npm ci → build → test → smoke` | ✅ |
| F9.4 | `node:test` 单元 + 集成测试，覆盖核心域 | ✅ |
| F9.5 | 每功能一个 conventional commit + push，历史可跟读 | ✅ |
| F9.6 | 中文设计文档 7 篇 + README | ✅ |
| F9.7 | 覆盖率门禁 / lint / e2e 浏览器测试 | ⬜ |

## 功能总数

- 已实现 **55** 项，部分实现 **1** 项，明确不做 **14** 项。
- 明确不做项全部集中在"上游规模性能力"，不与本项目的架构骨架冲突；取舍理由见 `01-architecture.md` 第 1、10 节。
