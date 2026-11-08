# 06 · 目标性能指标

> 本项目是本地 Agent 运行时，瓶颈几乎总在模型网络 I/O 与工具执行上。因此**框架自身开销**必须小到可以忽略。指标全部针对"框架开销"，不含真实模型推理耗时。

## 1. 指标总表

| # | 指标 | 目标值 | 测量方法 | 预算归属 |
| --- | --- | --- | --- | --- |
| P1 | 冷启动到可交互（`--version` 退出） | **< 150 ms** (P95) | `hyperfine` / `node --cpu-prof`，连续 30 次取 P95 | CLI + 模块加载 |
| P2 | `--dump-config` 组合并输出 | **< 50 ms** (P95) | 同上，profile=web，含 5 个 `--patch` | config 组合 |
| P3 | 插件树挂载（~30 行 ConfigRow） | **< 20 ms** | `performance.now()` 包住 `boot(rows)` | PluginHost |
| P4 | 单 step 框架开销（不含模型流与工具） | **< 5 ms** (P95) | loop 单测里统计 `step/start → step/end` 中非 await 部分 | AgentLoop |
| P5 | SSE chunk 解析吞吐 | **> 20 000 chunks/s** | 预生成 100k `data:` 帧喂给 `parseSSE` | llm/sse |
| P6 | `tool/call` delta 聚合（1000 个并行 call） | **< 30 ms** | 构造 1000 index 的 delta 序列 | llm/sse |
| P7 | 追加单条 SessionEvent（含 fsync 之外的写入） | **< 0.2 ms** (P99) | 连续 append 10k 条计时 | session/jsonl |
| P8 | 10k 事件 `replay()` | **< 200 ms** | 预热后读 JSONL 并重放 | session/store |
| P9 | 10k 事件 `deriveMessages()` | **< 80 ms** | 同上数据集投影 | session/projection |
| P10 | 内存基线（空闲，无会话） | **< 60 MB RSS** | `process.memoryUsage().rss` after boot | 全局 |
| P11 | 1k 事件常驻增量 | **< +8 MB** | 与 P10 对比 | session/store 内存索引 |
| P12 | 工具并发执行（concurrency=8，100 个 echo） | **< 250 ms** | `tools.execute` 批量 | tools/registry |
| P13 | Web `/api/health` 响应 | **< 10 ms** (P95) | 本地 fetch 100 次 | apps/web |
| P14 | headless `--json` 首事件延迟 | **< 100 ms** 从进程启动 | 计时 `run/start` | 启动链路 |
| P15 | CI 全量（2 个 job 并行） | **< 120 s** | Actions run duration | 工程 |

## 2. 非目标（明确不承诺）

- 模型首 token 延迟（TTFT）、token 吞吐：由 provider 决定，框架只保证不额外增加 > 5 ms。
- 大文件 / 大仓库索引性能：无 LSP、无向量检索，不在范围内。
- 多用户并发 Web 服务吞吐：Web 形态是本地单用户调试界面，默认绑 `127.0.0.1`。
- 压缩日志（zstd）与 vN 迁移链性能：本复刻未实现（见 `02-features.md` F3.11）。

## 3. 设计上如何保证

| 手段 | 对应指标 |
| --- | --- |
| 零运行时依赖、无框架初始化 | P1、P10 |
| 配置组合是纯数组操作，无 YAML 解析、无 IO（除 patch 文件） | P2、P3 |
| append-only 顺序写，不读改写；`stat/list` 只读 header，不加载事件 | P7、P8 |
| `deriveMessages()` 单次线性扫描，不建中间对象树 | P9 |
| SSE 用 `ReadableStream` 增量解码 + 按 index 原地聚合 delta，不做字符串反复拼接 | P5、P6 |
| 工具执行用 `Promise.all` + 信号量限流，不串行等待 | P12 |
| 事件总线监听者常驻数组，派发无反射 | P4 |
| 会话内存索引只存 `{seq, type, offset}`，不缓存全文 | P11 |

## 4. 测量方式

本地不跑测试与基准（见 `07-test-plan.md`），但保留可复现的测量入口，CI 可选执行：

```bash
npm run build
node bench/startup.mjs        # P1 / P2 / P3 / P14
node bench/session.mjs        # P7 / P8 / P9 / P11
node bench/sse.mjs            # P5 / P6
node bench/tools.mjs          # P12
```

每个脚本输出 JSON：`{ metric, p50, p95, p99, unit, node, platform }`，便于跨 Node 22 / 24 对比。当前里程碑以**功能与 CI 全绿**为首要验收，性能脚本作为后续门禁基线，不阻塞 M0–M9 的交付。

## 5. 回归红线

以下任一情况视为性能回归，需要修：

- P1 冷启动 > 300 ms；
- P4 单 step 框架开销 > 15 ms；
- P8 10k replay > 500 ms；
- P10 空闲 RSS > 120 MB；
- P15 CI > 180 s。

红线值留 2–3 倍余量，避免 CI 机器抖动造成误报。

## 6. 与上游指标的关系

上游 `BENCHMARK.md` 面向完整产品（含 Web 客户端、Electron、多插件生态），指标覆盖端到端 Agent 任务成功率与成本。本项目规模小得多，**不与之做数值对比**，只借其"框架开销应与模型开销解耦"的度量思路。本文所有目标值都是本复刻的自定预算。
