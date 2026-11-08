import type { HistoryMessage, SessionEvent } from './types.js';

/**
 * 模型历史投影：日志是唯一真相源（Model-visible means logged）。
 * assistant/attempt、request/*、turn/*、step/* 都不进模型历史。
 */
export function deriveMessages(events: SessionEvent[]): HistoryMessage[] {
  const names = new Map<string, string>();
  for (const event of events) {
    if (event.type === 'tool/call') names.set(event.callId, event.name);
  }

  const messages: HistoryMessage[] = [];
  for (const event of events) {
    switch (event.type) {
      case 'system/message':
        messages.push({ role: 'system', content: event.text });
        break;
      case 'user/message':
        messages.push({ role: 'user', content: event.text });
        break;
      case 'assistant/message': {
        const message: HistoryMessage = { role: 'assistant', content: event.content.text };
        if (event.content.toolCalls.length > 0) {
          message.tool_calls = event.content.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          }));
        }
        messages.push(message);
        break;
      }
      case 'tool/result': {
        const message: HistoryMessage = {
          role: 'tool',
          content: event.output,
          tool_call_id: event.callId,
        };
        const name = names.get(event.callId);
        if (name) message.name = name;
        messages.push(message);
        break;
      }
      default:
        break;
    }
  }
  return messages;
}

export function lastAssistantText(events: SessionEvent[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.type === 'assistant/message') return event.content.text;
  }
  return '';
}

/** 已发出 tool/call 但没有对应 tool/result 的调用（失败 step 需要补齐）。 */
export function missingToolResults(events: SessionEvent[]): Array<{ callId: string; name: string }> {
  const calls = new Map<string, string>();
  const settled = new Set<string>();
  for (const event of events) {
    if (event.type === 'tool/call') calls.set(event.callId, event.name);
    else if (event.type === 'tool/result') settled.add(event.callId);
  }
  return [...calls.entries()]
    .filter(([callId]) => !settled.has(callId))
    .map(([callId, name]) => ({ callId, name }));
}
