/** 模型历史词汇（放这里是为了让 projection 不依赖 llm 实现）。 */
export interface HistoryToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface HistoryMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface AssistantContent {
  text: string;
  toolCalls: HistoryToolCall[];
  usage?: { promptTokens: number; completionTokens: number };
}

interface EventBase {
  sessionId: string;
  seq: number;
  ts: number;
}

/**
 * durable SessionEvent：凡是模型可见的事实都必须落在这里。
 * turn/step/message/tool 事件可从日志完整重建一次模型请求。
 */
export type SessionEvent =
  | (EventBase & { type: 'session/created'; title?: string })
  | (EventBase & { type: 'turn/start'; turnId: string })
  | (EventBase & { type: 'turn/end'; turnId: string })
  | (EventBase & { type: 'step/start'; turnId: string; step: number })
  | (EventBase & { type: 'step/end'; turnId: string; step: number })
  | (EventBase & { type: 'system/message'; text: string })
  | (EventBase & { type: 'user/message'; text: string })
  | (EventBase & { type: 'assistant/message'; content: AssistantContent })
  | (EventBase & { type: 'assistant/attempt'; reason: string })
  | (EventBase & { type: 'tool/call'; callId: string; name: string; args: Record<string, unknown> })
  | (EventBase & { type: 'tool/result'; callId: string; ok: boolean; output: string; error?: string })
  | (EventBase & { type: 'request/header'; model: string; adapter: string; reason: string })
  | (EventBase & { type: 'request/context'; note: string });

type DistributeOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** append 时由 store 补齐 sessionId / seq / ts。 */
export type EventInput = DistributeOmit<SessionEvent, 'sessionId' | 'seq' | 'ts'>;

export interface SessionHeader {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** 当前生效的代际文件编号 */
  generation: number;
  /** 逻辑格式版本，未来版本拒绝打开 */
  format: number;
  eventCount: number;
  title?: string;
  forkedFrom?: string;
  forkAtSeq?: number;
}
