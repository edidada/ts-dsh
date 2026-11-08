import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBytes, parseSSE } from '../dist/llm/sse.js';
import { collectStream } from '../dist/llm/stream.js';
import { LlmRegistry } from '../dist/llm/registry.js';
import { createMockAdapter } from '../dist/llm/mock.js';
import { buildRequestBody, createDeepSeekAdapter } from '../dist/llm/deepseek.js';

async function collect(iterable) {
  const out = [];
  for await (const item of iterable) out.push(item);
  return out;
}

async function* strings(...pieces) {
  for (const piece of pieces) yield piece;
}

function sseResponse(sse, overrides = {}) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body: (async function* () { yield Buffer.from(sse, 'utf8'); })(),
    text: async () => sse,
    ...overrides,
  };
}

test('parseSSE: data / event / 注释 / 多行 data / [DONE]', async () => {
  const frames = await collect(parseSSE(strings(
    ': comment line\n',
    'event: message\n',
    'data: {"a":1}\n\n',
    'id: 7\n',
    'data: first\n',
    'data: second\n\n',
    'data: [DONE]\n\n',
  )));
  assert.equal(frames.length, 3);
  assert.equal(frames[0].event, 'message');
  assert.equal(frames[0].data, '{"a":1}');
  assert.equal(frames[1].id, '7');
  assert.equal(frames[1].data, 'first\nsecond');
  assert.equal(frames[2].data, '[DONE]');
});

test('parseSSE: 跨 chunk 半包与 CRLF / 裸 CR 边界', async () => {
  const frames = await collect(parseSSE(strings(
    'data: {"a":',
    '1}\r\n',
    '\r\ndata: two\n\n',
  )));
  assert.deepEqual(frames.map((f) => f.data), ['{"a":1}', 'two']);

  // CRLF 被 chunk 从中间切开（\r 在上一块末尾）
  const split = await collect(parseSSE(strings('data: one\r', '\r\ndata: two\r\n\r\n')));
  assert.deepEqual(split.map((f) => f.data), ['one', 'two']);

  // 流末尾残留一帧，没有结尾空行也能产出
  const tail = await collect(parseSSE(strings('data: tail')));
  assert.deepEqual(tail.map((f) => f.data), ['tail']);
});

test('decodeBytes: 跨 chunk 的多字节 UTF-8 不断字', async () => {
  const bytes = Buffer.from('你好, dsh', 'utf8');
  const pieces = [bytes.subarray(0, 2), bytes.subarray(2, 5), bytes.subarray(5)];
  const text = (await collect(decodeBytes(pieces))).join('');
  assert.equal(text, '你好, dsh');
});

test('collectStream: text 拼接、tool_call delta 按 index 聚合、usage 透传', async () => {
  async function* chunks() {
    yield { type: 'text-delta', text: 'hel' };
    yield { type: 'text-delta', text: 'lo' };
    yield { type: 'tool-call-delta', index: 1, id: 'c2', name: 'b', args: '{"x":' };
    yield { type: 'tool-call-delta', index: 0, id: 'c1', name: 'a', args: '{"y":1}' };
    yield { type: 'tool-call-delta', index: 1, args: '2}' };
    yield { type: 'done', usage: { promptTokens: 3, completionTokens: 4 } };
  }
  const result = await collectStream(chunks());
  assert.equal(result.text, 'hello');
  assert.deepEqual(result.toolCalls.map((c) => c.id), ['c1', 'c2']);
  assert.deepEqual(result.toolCalls[0].args, { y: 1 });
  assert.deepEqual(result.toolCalls[1].args, { x: 2 });
  assert.deepEqual(result.usage, { promptTokens: 3, completionTokens: 4 });
});

test('collectStream: 非法参数 JSON 保留 _raw；error chunk 抛错；取消抛 LLM_CANCELLED', async () => {
  async function* badArgs() {
    yield { type: 'tool-call-delta', index: 0, name: 'x', args: '{broken' };
    yield { type: 'done' };
  }
  assert.deepEqual((await collectStream(badArgs())).toolCalls[0].args, { _raw: '{broken' });

  async function* errored() {
    yield { type: 'error', message: 'upstream exploded' };
  }
  await assert.rejects(() => collectStream(errored()), (e) => e.code === 'LLM_STREAM_ERROR');

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => collectStream(createMockAdapter().stream({ model: 'mock', messages: [] }, controller.signal)),
    (e) => e.code === 'LLM_CANCELLED',
  );
});

test('buildRequestBody: model / messages / tools / stream_options 结构正确', () => {
  const body = buildRequestBody(
    {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'hi' },
      ],
      tools: [{ name: 'echo', description: 'echo tool', parameters: { type: 'object' } }],
      temperature: 0.2,
      maxTokens: 100,
    },
    'fallback-model',
  );
  assert.equal(body.model, 'deepseek-chat');
  assert.equal(body.stream, true);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 100);
  assert.equal(body.messages.length, 2);
  assert.equal(body.tools[0].type, 'function');
  assert.equal(body.tools[0].function.name, 'echo');
  assert.equal(buildRequestBody({ model: '', messages: [] }, 'fallback-model').model, 'fallback-model');
});

test('DeepSeek 适配器: 注入 fetch 解析 SSE，产出 text / tool_call / usage', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"echo","arguments":"{\\"text\\":\\"yo\\"}"}}]}}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
    'data: [DONE]\n\n',
  ].join('');
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return sseResponse(sse);
  };
  const adapter = createDeepSeekAdapter({ apiKey: 'sk-test', baseUrl: 'https://example.test/v1', fetchImpl });

  const result = await collectStream(adapter.stream({
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ name: 'echo', description: 'echo', parameters: { type: 'object' } }],
  }));

  assert.equal(captured.url, 'https://example.test/v1/chat/completions');
  assert.equal(captured.init.headers.authorization, 'Bearer sk-test');
  assert.match(captured.init.body, /"stream":true/);
  assert.equal(result.text, 'Hi');
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].id, 'call-1');
  assert.equal(result.toolCalls[0].args.text, 'yo');
  assert.deepEqual(result.usage, { promptTokens: 5, completionTokens: 2 });
});

test('DeepSeek 适配器: 非 2xx 抛 LLM_HTTP_ERROR', async () => {
  const fetchImpl = async () => sseResponse('', { ok: false, status: 429, statusText: 'Too Many Requests' });
  const adapter = createDeepSeekAdapter({ apiKey: 'sk-test', fetchImpl });
  await assert.rejects(
    () => collectStream(adapter.stream({ model: 'm', messages: [] })),
    (e) => e.code === 'LLM_HTTP_ERROR' && e.message.includes('429'),
  );
});

test('LlmRegistry: 无 Key 回退 Mock，有 Key 用 DeepSeek，可强制指定', () => {
  const previous = process.env.DSH_MODEL_ADAPTER;
  delete process.env.DSH_MODEL_ADAPTER;
  try {
    const registry = new LlmRegistry();
    registry.register(createMockAdapter());
    registry.register(createDeepSeekAdapter({ apiKey: 'sk-x', fetchImpl: async () => sseResponse('data: [DONE]\n\n') }));
    assert.deepEqual(registry.list(), ['deepseek', 'mock']);
    assert.equal(registry.resolve({ apiKey: '' }).id, 'mock');
    assert.equal(registry.resolve({ apiKey: 'sk-x' }).id, 'deepseek');
    assert.equal(registry.resolve({ apiKey: 'sk-x', requested: 'mock' }).id, 'mock');
    assert.throws(() => registry.resolve({ requested: 'nope' }), (e) => e.code === 'LLM_UNKNOWN_ADAPTER');

    const empty = new LlmRegistry();
    assert.throws(() => empty.resolve({ apiKey: 'sk-x' }), (e) => e.code === 'LLM_NO_ADAPTER');
  } finally {
    if (previous === undefined) delete process.env.DSH_MODEL_ADAPTER;
    else process.env.DSH_MODEL_ADAPTER = previous;
  }
});

test('Mock 适配器: script 编排「tool_call → 最终回答」两步', async () => {
  const adapter = createMockAdapter({
    script: [
      { text: 'calling', toolCalls: [{ id: 'c1', name: 'echo', args: { text: 'yo' } }] },
      { text: 'done' },
    ],
  });
  const first = await collectStream(adapter.stream({ model: 'mock', messages: [{ role: 'user', content: 'go' }] }));
  assert.equal(first.text, 'calling');
  assert.equal(first.toolCalls[0].name, 'echo');
  assert.deepEqual(first.toolCalls[0].args, { text: 'yo' });

  const second = await collectStream(adapter.stream({ model: 'mock', messages: [{ role: 'user', content: 'go' }] }));
  assert.equal(second.text, 'done');
  assert.equal(second.toolCalls.length, 0);
});

test('Mock 适配器: 默认回显与关键字触发工具调用', async () => {
  const adapter = createMockAdapter();
  const plain = await collectStream(adapter.stream({ model: 'mock', messages: [{ role: 'user', content: 'hello' }] }));
  assert.equal(plain.text, 'MOCK: hello');

  const tool = await collectStream(adapter.stream({ model: 'mock', messages: [{ role: 'user', content: 'use tool please' }] }));
  assert.equal(tool.toolCalls[0].name, 'echo');

  const afterTool = await collectStream(adapter.stream({
    model: 'mock',
    messages: [{ role: 'user', content: 'go' }, { role: 'tool', content: 'result-42', tool_call_id: 'c1' }],
  }));
  assert.equal(afterTool.text, '完成：result-42');
});
