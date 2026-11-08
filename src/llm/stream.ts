import { DshError } from '../core/errors.js';
import type { AssistantStreamResult, StreamChunk, ToolCall, Usage } from './types.js';

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    // 模型偶尔吐出不完整 JSON：保留原文，交给工具层决定如何处理
    return { _raw: raw };
  }
}

/** 把流式 chunk 结算成一条完整的 assistant 内容；tool_call delta 按 index 聚合。 */
export async function collectStream(
  source: AsyncIterable<StreamChunk>,
  signal?: AbortSignal,
): Promise<AssistantStreamResult> {
  let text = '';
  let usage: Usage | undefined;
  const pending = new Map<number, { id: string; name: string; args: string }>();

  for await (const chunk of source) {
    if (signal?.aborted) throw new DshError('LLM_CANCELLED', 'model request was cancelled');
    switch (chunk.type) {
      case 'text-delta':
        text += chunk.text;
        break;
      case 'tool-call-delta': {
        const current = pending.get(chunk.index) ?? { id: '', name: '', args: '' };
        if (chunk.id) current.id = chunk.id;
        if (chunk.name) current.name = chunk.name;
        if (chunk.args) current.args += chunk.args;
        pending.set(chunk.index, current);
        break;
      }
      case 'done':
        if (chunk.usage) usage = chunk.usage;
        break;
      case 'error':
        throw new DshError('LLM_STREAM_ERROR', chunk.message);
      default:
        break;
    }
  }

  const toolCalls: ToolCall[] = [...pending.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, value]) => ({
      id: value.id || `call-${index}`,
      name: value.name,
      args: parseArgs(value.args),
    }));

  return { text, toolCalls, ...(usage ? { usage } : {}) };
}
