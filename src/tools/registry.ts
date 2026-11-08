import type { EventBus } from '../core/events.js';
import type { Disposable, ScopeKey } from '../core/types.js';
import { resolveScoped } from '../core/scope.js';
import type {
  ExecuteOptions,
  ExecutePayload,
  PostExecutePayload,
  PreExecutePayload,
  Tool,
  ToolCallRequest,
  ToolResult,
  ToolSchema,
  ToolContext,
} from './types.js';

const MAX_OUTPUT = 20_000;

/**
 * ctx.tools：作用域工具注册表 + 受控执行流水线。
 * pre-execute → execute → post-execute 三段都是 waterfall 事件（能力接缝的策略挂载点）。
 * 审批策略不写死在这里，而是由 core/approval 插件监听 tools/pre-execute 注入。
 */
export class ToolRegistry {
  private readonly globalTools = new Map<string, Tool>();
  private readonly scopedTools = new Map<ScopeKey, Map<string, Tool>>();
  private readonly restrictions = new Map<ScopeKey, Set<string>>();

  constructor(
    private readonly events: EventBus,
    private readonly cwd: string,
    private readonly timeoutMs = 10_000,
  ) {}

  register(tool: Tool, scope?: ScopeKey): Disposable {
    if (scope) {
      const map = this.scopedTools.get(scope) ?? new Map<string, Tool>();
      map.set(tool.name, tool);
      this.scopedTools.set(scope, map);
      return { dispose: () => { map.delete(tool.name); } };
    }
    this.globalTools.set(tool.name, tool);
    return {
      dispose: () => {
        if (this.globalTools.get(tool.name) === tool) this.globalTools.delete(tool.name);
      },
    };
  }

  /** 对某个 scope 的 global 集合做交集过滤（多次调用取交集）。 */
  restrict(scope: ScopeKey, names: string[]): Disposable {
    const previous = this.restrictions.get(scope);
    const incoming = new Set(names);
    const merged = previous ? new Set([...previous].filter((name) => incoming.has(name))) : incoming;
    this.restrictions.set(scope, merged);
    return {
      dispose: () => {
        if (previous) this.restrictions.set(scope, previous);
        else this.restrictions.delete(scope);
      },
    };
  }

  private visible(scope?: ScopeKey): Map<string, Tool> {
    return resolveScoped(
      this.globalTools,
      this.scopedTools,
      scope,
      scope ? this.restrictions.get(scope) : undefined,
    );
  }

  resolve(name: string, scope?: ScopeKey): Tool | undefined {
    return this.visible(scope).get(name);
  }

  has(name: string, scope?: ScopeKey): boolean {
    return this.visible(scope).has(name);
  }

  list(scope?: ScopeKey): Tool[] {
    return [...this.visible(scope).values()];
  }

  /** 进入 prompt 装配的 schema（不含 risk / handler）。 */
  schemas(scope?: ScopeKey): ToolSchema[] {
    return this.list(scope).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  async execute(calls: ToolCallRequest[], options: ExecuteOptions = {}): Promise<ToolResult[]> {
    const limit = Math.max(1, Math.min(options.concurrency ?? 4, calls.length || 1));
    const results: ToolResult[] = new Array(calls.length);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= calls.length) return;
        results[index] = await this.executeOne(calls[index]!, options);
      }
    };
    await Promise.all(Array.from({ length: limit }, () => worker()));
    return results;
  }

  private async executeOne(call: ToolCallRequest, options: ExecuteOptions): Promise<ToolResult> {
    const started = Date.now();
    const make = (ok: boolean, output: string, error?: string): ToolResult => ({
      callId: call.callId,
      name: call.name,
      ok,
      output: output.slice(0, MAX_OUTPUT),
      ...(error ? { error } : {}),
      durationMs: Date.now() - started,
    });

    if (options.signal?.aborted) return this.finish(make(false, '', 'tool execution cancelled'), call, undefined);

    let tool = this.resolve(call.name, options.scope);
    const pre = await this.events.emit<PreExecutePayload>('tools/pre-execute', {
      call,
      tool,
      scope: options.scope,
      rejected: false,
      reason: '',
    });
    if (pre.tool) tool = pre.tool;

    if (pre.rejected || !tool) {
      const reason = pre.reason || (pre.rejected ? 'execution rejected by policy' : `unknown tool "${call.name}"`);
      return this.finish(make(false, '', reason), call, tool);
    }

    const exec = await this.events.emit<ExecutePayload>('tools/execute', {
      call,
      tool,
      output: undefined,
      error: undefined,
    });
    let output = exec.output;
    let error = exec.error;
    if (output === undefined && error === undefined) {
      try {
        output = await this.runHandler(tool, call, options);
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
    }
    return this.finish(make(!error, output ?? '', error), call, tool);
  }

  private async runHandler(tool: Tool, call: ToolCallRequest, options: ExecuteOptions): Promise<string> {
    const ctx: ToolContext = { cwd: options.cwd ?? this.cwd, ...(options.signal ? { signal: options.signal } : {}) };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([
        Promise.resolve().then(() => tool.handler(call.args, ctx)),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`tool "${tool.name}" timed out after ${this.timeoutMs}ms`)),
            this.timeoutMs,
          );
        }),
      ]);
      return typeof raw === 'string' ? raw : String(raw);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async finish(result: ToolResult, call: ToolCallRequest, tool: Tool | undefined): Promise<ToolResult> {
    const post = await this.events.emit<PostExecutePayload>('tools/post-execute', { call, tool, result });
    return post.result;
  }
}
