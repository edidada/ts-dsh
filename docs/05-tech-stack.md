# 05 · 技术选型

> 一句话：**Node 24 + TypeScript + 零运行时依赖 + `node:test` + GitHub Actions**。选型为"架构保真度"与"CI 可验证性"服务，而不是追新。

## 1. 选型总表

| 维度 | 选型 | 理由 | 被否决方案 |
| --- | --- | --- | --- |
| 运行时 | **Node.js >= 22.18（CI 覆盖 22 / 24）** | 上游 `dsh` 同为 Node/TypeScript 生态；原生 `fetch`、`node:test`、`AbortSignal`、ESM 开箱即用 | Bun / Deno：与上游生态不一致，CI 镜像与 `gh` 集成成本更高 |
| 语言 | **TypeScript 5.9（strict）** | 与上游同语言；`SessionEvent` 联合类型、`ctx` 服务表、seam 接口都靠类型系统表达 | 纯 JS：丢掉 biggest value（类型即架构文档）；TS 7 原生编译器：预览期 CLI 行为不稳定，锁 5.9 更稳 |
| 模块 | **ESM（`"type": "module"`）+ NodeNext** | 与上游一致；`node --test` 与 `import ../dist/*.js` 路径直白 | CommonJS：顶层 await / ESM-only 工具链会打架 |
| 构建 | **`tsc -p tsconfig.json` → `dist/`** | 零配置成本、类型检查与产物一次完成、`noEmitOnError` 保证 CI 失败即停 | tsdown/esbuild/tsup：多一个依赖与配置面，收益仅为打包体积 |
| 运行时依赖 | **0 个** | 插件宿主、SSE、HTTP、JSONL、REPL 全用 Node 内置模块；`npm ci` 极快且无供应链面 | commander/yargs（自写 ~80 行参数解析）、chalk/ora（ANSI 手写）、yaml/js-yaml（见第 3 节）、cordis（见第 2 节） |
| 开发依赖 | `typescript`、`@types/node` 仅此两个 | 类型检查必需的绝对最小集 | eslint/prettier/vitest：CI 步骤越少越不容易红；本任务以"CI 日志驱动修复"为回路 |
| 测试框架 | **`node:test` + `node:assert/strict`** | Node 内置，`node --test test/*.test.mjs` 无需安装；跑 `dist` 产物，等价于验证真实发布物 | Vitest/Jest：引入依赖与配置文件，与"零依赖"目标冲突 |
| 配置格式 | **JSON（`cordis.patch.json`）** | 零解析器依赖，`JSON.parse` 即校验；patch 语义简单，足够表达 replace/insert/remove | 上游 YAML（`cordis.patch.yml`）：需引入 `yaml` 依赖或自写 YAML 子集解析器，收益低、出错面大 |
| 配置文件 | `tsconfig.json` / `package-lock.json` 提交入库 | `npm ci` 可复现，CI 不漂移 | 不提交 lock：`npm ci` 直接失败 |
| 模型协议 | **OpenAI 兼容 `/chat/completions` + SSE** | DeepSeek 官方兼容；fetch 可注入，离线可测 | 厂商私有 SDK：多依赖、难注入、绑死单一 provider |
| 离线策略 | **Mock 适配器 + 无 Key 自动回退** | CI 无网络/无密钥也能跑通整条 turn 链路 | CI 里塞假 Key + mock server：多一层不确定 |
| CI | **GitHub Actions，Node 22/24 矩阵** | 与"推送到 edidada 并看日志"的工作流直接契合；`gh run view --log-failed` 可读性好 | GitLab CI / 自建 runner：与本次 `gh` 推送链路不匹配 |
| 远端 | **SSH `git@github.com:edidada/ts-dsh.git`** | 环境已验证 `ssh -T git@github.com` 以 `edidada` 认证成功 | HTTPS + credential helper：多一层凭据配置 |
| 提交粒度 | 每功能一个 conventional commit + push | 用户要求"对新手友好"，历史可逐步跟读 | 一次性大提交 |

## 2. 为什么不直接依赖 Cordis

上游的插件系统由 Cordis 驱动，其论文提出**空间可组合性**（组件声明依赖，运行时在依赖出现/消失时响应）与**时间可组合性**（组件移除时清理其被追踪的副作用）。

本项目选择实现这两条语义的**最小内化版本**：

- 空间：`ctx.provide / get / waitFor / onService`，服务可等待、可通知；
- 时间：`ctx.onDispose` 登记可逆副作用，`PluginHost.unmount` 逆序回滚，做到"移除插件即移除它注册的一切"。

理由：本项目是**教学级架构复刻**，读者需要看到机制本身而不是通过一个框架黑盒观察它；同时避免引入上游同名依赖造成"复刻"变"封装"。取舍边界写在 `01-architecture.md` 第 10 节。

## 3. 为什么 JSON 而不是 YAML

上游 patch 是 `cordis.patch.yml`。本复刻改为 JSON，原因：

1. **零依赖**：`JSON.parse` 是运行时内置，不需要 `yaml` 包，也不需要自写容易出错的 YAML 子集解析器。
2. **可校验**：`--dump-config-schema` 输出 JSON Schema，patch 文件可直接被编辑器校验。
3. **语义等价**：patch 只有 `replace / insert / remove` 三种操作与少量标量字段，JSON 表达力完全够用。

这是**明确记录的有意偏差**，不是遗漏。`profiles/` 里的内置 bundle/profile 用 TypeScript 对象定义（上游也是 `package.json` 的 `dsh` 字段 + patch 文件），因此用户手写配置文件只涉及 patch 覆盖层。

## 4. 关键 Node 内置模块清单

| 模块 | 用途 |
| --- | --- |
| `node:fs` / `node:fs/promises` | JSONL 会话、配置、静态页 |
| `node:path` / `node:os` / `node:url` | `$DSH_HOME`、路径解析 |
| `node:readline` / `node:process` | TUI REPL、stdin(`-`)、环境变量 |
| `node:http` | Web 应用与静态服务 |
| `node:child_process` | `run_command` 工具（`execFile`，不拼 shell，避免命令注入） |
| `node:test` / `node:assert/strict` | 测试 |
| `node:stream` / `TextDecoder` | SSE 帧解码 |
| 全局 `fetch` / `AbortController` | DeepSeek 适配器 |

## 5. 安全性取舍

- `run_command` 使用 `execFile(command, args)`，**不经过 shell**，不做字符串拼接，避免命令注入；带超时与输出上限。
- `read_file` / `write_file` 受工作区写根约束，`--add-dir` 才能扩权；路径用 `path.resolve` + 前缀校验，拒绝 `..` 越界。
- Web 应用只绑定 `127.0.0.1`，请求体大小与并发有限制，不暴露任意文件读取。
- API Key 只从环境变量读取，不写日志、不落盘到会话事件；诊断信息统一 stderr 且做脱敏。

## 6. 兼容性矩阵

| 环境 | 支持 |
| --- | --- |
| Node 22.18+ | ✅（CI job 1） |
| Node 24.x | ✅（CI job 2，开发机 v24.22.1） |
| Node 20 | ⚠️ 未验证（`fetch` 可用但类型与 `node:test` 行为有差异） |
| Windows / macOS / Linux | ✅（路径用 `path`，子进程用 `execFile`，不依赖 POSIX 专用 API） |
| 无网络 / 无 DeepSeek Key | ✅（自动回退 Mock，CI 即此模式） |
