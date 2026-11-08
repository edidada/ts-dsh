import type { ScopeKey } from '../core/types.js';

export type AgentStatus = 'idle' | 'running' | 'done' | 'error';

export interface Agent {
  id: string;
  sessionId: string;
  scope: ScopeKey;
  status: AgentStatus;
  meta: Record<string, unknown>;
}

export interface CreateAgentOptions {
  sessionId: string;
  meta?: Record<string, unknown>;
}

export type RunEvent =
  | { type: 'run/start'; sessionId: string; turnId: string }
  | { type: 'step/start'; step: number }
  | { type: 'assistant-stream'; delta: string }
  | { type: 'assistant/message'; text: string; toolCalls: number }
  | { type: 'tool/call'; callId: string; name: string }
  | { type: 'tool/result'; callId: string; ok: boolean; output: string }
  | { type: 'step/end'; step: number }
  | { type: 'error'; message: string }
  | { type: 'run/end'; sessionId: string; turnId: string; text: string; steps: number; cancelled: boolean };

export interface RunOptions {
  input?: string;
  maxSteps?: number;
  signal?: AbortSignal;
  scope?: ScopeKey;
  model?: string;
  onEvent?: (event: RunEvent) => void;
}

export interface RunResult {
  sessionId: string;
  turnId: string;
  text: string;
  steps: number;
  cancelled: boolean;
}
