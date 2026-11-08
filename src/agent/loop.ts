import type { EventBus } from '../core/events.js';
import { describe } from '../core/errors.js';
import { newId } from '../util/id.js';
import type { SessionStore } from '../session/store.js';
import type { AssistantContent } from '../session/types.js';
import type { LlmRegistry } from '../llm/registry.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolCallRequest } from '../tools/types.js';
import type { AssistantStreamResult, Message, StreamChunk, StreamRequest, ToolCall } from '../llm/types.js';
import { collectStream } from '../llm/stream.js';
import type { SystemPromptAssembler } from '../prompt/assembler.js';
import type { AgentRegistry } from './registry.js';
import type { RunEvent, RunOptions, RunResult } from './types.js';

interface PreStepPayload {
  turnId: string;
  step: number;
  messages: Message[];
  rejected: boolean;
  reason: string;
}

interface RequestPayload {
  request: StreamRequest;
  adapterId?: string;
}

export interface AgentLoopDeps {
  sessions: SessionStore;
  llm: LlmRegistry;
  tools: ToolRegistry;
  prompt: SystemPromptAssembler;
  agents: AgentRegistry;
  events: EventBus;
  maxSteps: number;
  model: string;
  cwd: string;
}

/**
 * ctx.agentLoop：默认 turn/step 驱动。
 * turn = 0..n step；step = 一次模型请求 + 其触发的工具调用。
 * 模型可见事实全部落盘；失败/取消记为 assistant/attempt 并补齐悬空 tool result。
 */
export class AgentLoop {
  constructor(private readonly deps: AgentLoopDeps) {}

  async run(sessionId: string, options: RunOptions = {}): Promise<RunResult> {
    const { sessions, llm, tools, prompt, agents, events } = this.deps;
    const turnId = newId('turn');
    const agent = await agents.create({ sessionId });
    const scope = options.scope ?? agent.scope;
    const signal = options.signal;
    const maxSteps = Math.max(1, options.maxSteps ?? this.deps.maxSteps);
    const emit = (event: RunEvent): void => {
      try {
        options.onEvent?.(event);
      } catch {
        // 观察者的异常不影响主循环
      }
    };

    let steps = 0;
    let cancelled = false;
    let failure: unknown;

    sessions.append(sessionId, { type: 'turn/start', turnId });
    emit({ type: 'run/start', sessionId, turnId });
    this.syncSystemPrompt(sessionId, prompt.assemble(scope));
    if (options.input) sessions.append(sessionId, { type: 'user/message', text: options.input });

    try {
      for (let step = 0; step < maxSteps; step += 1) {
        if (signal?.aborted) {
          cancelled = true;
          break;
        }

        sessions.append(sessionId, { type: 'step/start', turnId, step });
        emit({ type: 'step/start', step });

        const pre = await events.emit<PreStepPayload>('agent/pre-step', {
          turnId,
          step,
          messages: sessions.deriveMessages(sessionId),
          rejected: false,
          reason: '',
        });
        if (pre.rejected) {
          // durable turn 可以是零 step
          sessions.append(sessionId, { type: 'step/end', turnId, step });
          emit({ type: 'step/end', step });
          break;
        }

        const request: StreamRequest = {
          model: options.model ?? this.deps.model,
          messages: pre.messages,
          tools: tools.schemas(scope),
        };
        const prepared = await events.emit<RequestPayload>('agent/request', { request, adapterId: undefined });
        const adapter = llm.resolve(prepared.adapterId ? { requested: prepared.adapterId } : {});
        sessions.append(sessionId, {
          type: 'request/header',
          model: request.model,
          adapter: adapter.id,
          reason: 'step',
        });

        let content: AssistantStreamResult;
        try {
          content = await collectStream(this.tap(adapter.stream(request, signal), emit), signal);
        } catch (error) {
          cancelled = Boolean(signal?.aborted);
          sessions.append(sessionId, { type: 'assistant/attempt', reason: describe(error) });
          sessions.append(sessionId, { type: 'step/end', turnId, step });
          emit({ type: 'step/end', step });
          throw error;
        }

        const toolCalls: ToolCall[] = content.toolCalls;
        const assistantContent: AssistantContent = {
          text: content.text,
          toolCalls: toolCalls.map((call) => ({ id: call.id, name: call.name, args: call.args })),
          ...(content.usage ? { usage: content.usage } : {}),
        };
        sessions.append(sessionId, { type: 'assistant/message', content: assistantContent });
        emit({ type: 'assistant/message', text: content.text, toolCalls: toolCalls.length });
        steps = step + 1;

        if (toolCalls.length === 0) {
          sessions.append(sessionId, { type: 'step/end', turnId, step });
          emit({ type: 'step/end', step });
          break;
        }

        const calls: ToolCallRequest[] = toolCalls.map((call) => ({
          callId: call.id,
          name: call.name,
          args: call.args,
        }));
        for (const call of calls) {
          sessions.append(sessionId, { type: 'tool/call', callId: call.callId, name: call.name, args: call.args });
          emit({ type: 'tool/call', callId: call.callId, name: call.name });
        }
        const results = await tools.execute(calls, { scope, signal, cwd: this.deps.cwd });
        for (const result of results) {
          sessions.append(sessionId, {
            type: 'tool/result',
            callId: result.callId,
            ok: result.ok,
            output: result.output,
            ...(result.error ? { error: result.error } : {}),
          });
          emit({ type: 'tool/result', callId: result.callId, ok: result.ok, output: result.output });
        }
        sessions.append(sessionId, { type: 'step/end', turnId, step });
        emit({ type: 'step/end', step });
      }
    } catch (error) {
      failure = error;
    }

    // 失败/中断 step 里的悬空 tool/call 必须补 result，否则模型历史出现悬空调用
    for (const missing of sessions.missingToolResults(sessionId)) {
      sessions.append(sessionId, {
        type: 'tool/result',
        callId: missing.callId,
        ok: false,
        output: '',
        error: 'tool result missing after failed step',
      });
    }
    await events.emit('agent/turn-stopping', { turnId, sessionId });
    sessions.append(sessionId, { type: 'turn/end', turnId });

    const text = sessions.lastAssistantText(sessionId);
    if (failure) emit({ type: 'error', message: describe(failure) });
    emit({ type: 'run/end', sessionId, turnId, text, steps, cancelled });
    agents.remove(agent.id);
    if (failure) throw failure;
    return { sessionId, turnId, text, steps, cancelled };
  }

  /** system prompt 以 durable system/message 形式存在日志里，内容变化才追加。 */
  private syncSystemPrompt(sessionId: string, messages: Message[]): void {
    const text = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
    const existing = this.deps.sessions.events(sessionId).filter((event) => event.type === 'system/message');
    const last = existing.at(-1);
    const lastText = last && last.type === 'system/message' ? last.text : undefined;
    if (lastText !== text) {
      this.deps.sessions.append(sessionId, { type: 'system/message', text });
    }
  }

  private async *tap(source: AsyncIterable<StreamChunk>, emit: (event: RunEvent) => void): AsyncGenerator<StreamChunk> {
    for await (const chunk of source) {
      if (chunk.type === 'text-delta') emit({ type: 'assistant-stream', delta: chunk.text });
      yield chunk;
    }
  }
}
