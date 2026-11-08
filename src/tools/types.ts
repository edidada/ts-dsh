import type { ScopeKey } from '../core/types.js';

export type ToolRisk = 'read' | 'write' | 'exec';

/** 模型可见的工具 schema（进 prompt 装配）。 */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolContext {
  cwd: string;
  signal?: AbortSignal;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => string | Promise<string>;

export interface Tool extends ToolSchema {
  risk: ToolRisk;
  handler: ToolHandler;
}

export interface ToolCallRequest {
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  name: string;
  ok: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

export interface ExecuteOptions {
  scope?: ScopeKey;
  signal?: AbortSignal;
  concurrency?: number;
  cwd?: string;
}

/** tools/pre-execute 的载荷；监听者可改写 args 或拒绝执行。 */
export interface PreExecutePayload {
  call: ToolCallRequest;
  tool: Tool | undefined;
  scope: ScopeKey | undefined;
  rejected: boolean;
  reason: string;
}

/** tools/execute 的载荷；监听者设置 output/error 可短路默认执行。 */
export interface ExecutePayload {
  call: ToolCallRequest;
  tool: Tool;
  output: string | undefined;
  error: string | undefined;
}

/** tools/post-execute 的载荷；监听者可改写最终 result。 */
export interface PostExecutePayload {
  call: ToolCallRequest;
  tool: Tool | undefined;
  result: ToolResult;
}
