import type { HistoryMessage } from '../session/types.js';

/** 模型消息词汇与 session 投影共用同一结构，避免两层类型转换。 */
export type Message = HistoryMessage;

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export type StreamChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call-delta'; index: number; id?: string; name?: string; args?: string }
  | { type: 'done'; usage?: Usage }
  | { type: 'error'; message: string };

export interface StreamRequest {
  model: string;
  messages: Message[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
}

/** 能力接缝的 Service Definition：换 provider 不改消费方。 */
export interface ModelAdapter {
  readonly id: string;
  readonly models: string[];
  stream(req: StreamRequest, signal?: AbortSignal): AsyncIterable<StreamChunk>;
}

export interface AssistantStreamResult {
  text: string;
  toolCalls: ToolCall[];
  usage?: Usage;
}
