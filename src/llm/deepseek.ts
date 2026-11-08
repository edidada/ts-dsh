import { DshError } from '../core/errors.js';
import { envStr } from '../util/env.js';
import { decodeBytes, parseSSE } from './sse.js';
import type { ModelAdapter, StreamChunk, StreamRequest, Usage } from './types.js';

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  body: AsyncIterable<Uint8Array> | null;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init: Record<string, unknown>) => Promise<FetchLikeResponse>;

export interface DeepSeekOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** 注入 fetch，便于离线单测；不注入时用全局 fetch。 */
  fetchImpl?: FetchLike;
}

interface OpenAIDelta {
  content?: string;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface OpenAIChunk {
  choices?: Array<{ delta?: OpenAIDelta }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** 构造 OpenAI 兼容请求体；单独导出便于断言。 */
export function buildRequestBody(req: StreamRequest, defaultModel: string): Record<string, unknown> {
  return {
    model: req.model || defaultModel,
    messages: req.messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
      ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
      ...(message.name ? { name: message.name } : {}),
    })),
    stream: true,
    stream_options: { include_usage: true },
    ...(req.tools && req.tools.length > 0
      ? {
          tools: req.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
        }
      : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
  };
}

function toStreamChunks(chunk: OpenAIChunk): StreamChunk[] {
  const out: StreamChunk[] = [];
  for (const choice of chunk.choices ?? []) {
    const delta = choice.delta;
    if (!delta) continue;
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      out.push({ type: 'text-delta', text: delta.content });
    }
    for (const call of delta.tool_calls ?? []) {
      const fn = call.function ?? {};
      out.push({
        type: 'tool-call-delta',
        index: typeof call.index === 'number' ? call.index : 0,
        ...(call.id ? { id: call.id } : {}),
        ...(fn.name ? { name: fn.name } : {}),
        ...(typeof fn.arguments === 'string' ? { args: fn.arguments } : {}),
      });
    }
  }
  return out;
}

/** DeepSeek（OpenAI 兼容 /chat/completions）流式适配器。 */
export function createDeepSeekAdapter(options: DeepSeekOptions = {}): ModelAdapter {
  const apiKey = options.apiKey ?? envStr('DEEPSEEK_API_KEY');
  const baseUrl = (options.baseUrl ?? envStr('DEEPSEEK_BASE_URL', 'https://api.deepseek.com')).replace(/\/+$/, '');
  const defaultModel = options.model ?? envStr('DSH_MODEL', 'deepseek-chat');
  const fetchImpl: FetchLike = options.fetchImpl ?? (globalThis as unknown as { fetch: FetchLike }).fetch;

  return {
    id: 'deepseek',
    models: [defaultModel],
    async *stream(req: StreamRequest, signal?: AbortSignal): AsyncIterable<StreamChunk> {
      if (!fetchImpl) throw new DshError('LLM_NO_FETCH', 'global fetch is not available');
      if (signal?.aborted) throw new DshError('LLM_CANCELLED', 'model request was cancelled');

      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(buildRequestBody(req, defaultModel)),
        signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new DshError(
          'LLM_HTTP_ERROR',
          `DeepSeek API ${response.status} ${response.statusText}`,
          detail.slice(0, 300),
        );
      }
      if (!response.body) throw new DshError('LLM_NO_BODY', 'DeepSeek API returned no response body');

      let usage: Usage | undefined;
      for await (const frame of parseSSE(decodeBytes(response.body))) {
        if (signal?.aborted) throw new DshError('LLM_CANCELLED', 'model request was cancelled');
        if (frame.data === '[DONE]') break;
        let parsed: OpenAIChunk;
        try {
          parsed = JSON.parse(frame.data) as OpenAIChunk;
        } catch {
          continue;
        }
        if (parsed.usage) {
          usage = {
            promptTokens: parsed.usage.prompt_tokens ?? 0,
            completionTokens: parsed.usage.completion_tokens ?? 0,
          };
        }
        for (const chunk of toStreamChunks(parsed)) yield chunk;
      }
      yield { type: 'done', ...(usage ? { usage } : {}) };
    },
  };
}
