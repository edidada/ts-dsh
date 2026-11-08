import { DshError } from '../core/errors.js';
import type { Message, ModelAdapter, StreamChunk, StreamRequest } from './types.js';

export interface MockTurn {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
}

export interface MockOptions {
  /** 编排好的多轮响应；用尽后重复最后一轮。省略则走默认回显逻辑。 */
  script?: MockTurn[];
  /** 默认回显前缀 */
  prefix?: string;
}

function lastUserText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.role === 'user') return messages[i]!.content;
  }
  return '';
}

/**
 * 确定性 Mock 适配器：不联网、不需要 Key。
 * - 给 script 时可精确编排「先 tool_call，收到 tool result 后给最终回答」。
 * - 不给 script 时：任务文本含 tool/调用 等关键字会发起一次 echo 工具调用，否则回显。
 */
export function createMockAdapter(options: MockOptions = {}): ModelAdapter {
  const script = options.script && options.script.length > 0 ? options.script : undefined;
  const prefix = options.prefix ?? 'MOCK: ';
  let cursor = 0;

  return {
    id: 'mock',
    models: ['mock'],
    async *stream(req: StreamRequest, signal?: AbortSignal): AsyncIterable<StreamChunk> {
      if (signal?.aborted) throw new DshError('LLM_CANCELLED', 'model request was cancelled');

      const turn = script ? script[Math.min(cursor, script.length - 1)] : undefined;
      cursor += 1;

      if (turn !== undefined) {
        if (turn.text) yield { type: 'text-delta', text: turn.text };
        for (let index = 0; index < (turn.toolCalls ?? []).length; index += 1) {
          const call = turn.toolCalls![index]!;
          yield {
            type: 'tool-call-delta',
            index,
            id: call.id,
            name: call.name,
            args: JSON.stringify(call.args),
          };
        }
        yield { type: 'done', usage: { promptTokens: 1, completionTokens: 1 } };
        return;
      }

      const text = lastUserText(req.messages);
      const last = req.messages.at(-1);
      if (last && last.role === 'tool') {
        yield { type: 'text-delta', text: `完成：${last.content}` };
        yield { type: 'done', usage: { promptTokens: 1, completionTokens: 1 } };
        return;
      }
      if (/tool|调用|使用工具|use tool/i.test(text)) {
        yield { type: 'text-delta', text: '我先调用工具。' };
        yield {
          type: 'tool-call-delta',
          index: 0,
          id: 'mock-call-1',
          name: 'echo',
          args: JSON.stringify({ text: text || 'hello' }),
        };
        yield { type: 'done', usage: { promptTokens: 1, completionTokens: 1 } };
        return;
      }
      yield { type: 'text-delta', text: `${prefix}${text}` };
      yield { type: 'done', usage: { promptTokens: 1, completionTokens: 1 } };
    },
  };
}
