import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventBus } from '../dist/core/events.js';
import { SessionStore } from '../dist/session/store.js';
import { LlmRegistry } from '../dist/llm/registry.js';
import { createMockAdapter } from '../dist/llm/mock.js';
import { ToolRegistry } from '../dist/tools/registry.js';
import { createBuiltinTools } from '../dist/tools/builtin.js';
import { SystemPromptAssembler } from '../dist/prompt/assembler.js';
import { AgentRegistry } from '../dist/agent/registry.js';
import { AgentLoop } from '../dist/agent/loop.js';

function setup(config = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-dsh-loop-'));
  const events = new EventBus();
  const sessions = new SessionStore(home);
  const llm = new LlmRegistry();
  llm.register(createMockAdapter(config.script ? { script: config.script } : {}));
  const tools = new ToolRegistry(events, home, 2000);
  for (const builtin of createBuiltinTools(home)) tools.register(builtin);
  for (const extra of config.extraTools ?? []) tools.register(extra);
  const prompt = new SystemPromptAssembler(tools);
  const agents = new AgentRegistry(events);
  const loop = new AgentLoop({
    sessions, llm, tools, prompt, agents, events,
    maxSteps: config.maxSteps ?? 8,
    model: 'mock',
    cwd: home,
  });
  const id = sessions.create().header.id;
  return { home, events, sessions, llm, tools, prompt, agents, loop, id };
}

test('AgentLoop: 两步 turn（tool_call → tool/result → 最终回答），durable 序列完整', async () => {
  const ctx = setup({
    script: [
      { text: 'calling', toolCalls: [{ id: 'c1', name: 'echo', args: { text: 'yo' } }] },
      { text: 'done' },
    ],
  });
  const result = await ctx.loop.run(ctx.id, { input: 'go' });
  assert.equal(result.text, 'done');
  assert.equal(result.steps, 2);
  assert.equal(result.cancelled, false);

  const events = ctx.sessions.events(ctx.id);
  assert.equal(events[0].type, 'session/created');
  assert.equal(events[1].type, 'turn/start');
  assert.ok(events.findIndex((e) => e.type === 'turn/start') < events.findIndex((e) => e.type === 'user/message'));
  assert.equal(events.at(-1).type, 'turn/end');
  assert.equal(events.filter((e) => e.type === 'tool/call').length, 1);
  assert.equal(events.filter((e) => e.type === 'tool/result').length, 1);
  assert.equal(events.filter((e) => e.type === 'assistant/message').length, 2);
  assert.equal(ctx.sessions.replay(ctx.id).openTurn, null);
  assert.deepEqual(ctx.sessions.missingToolResults(ctx.id), []);

  const messages = ctx.sessions.deriveMessages(ctx.id);
  assert.deepEqual(messages.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'assistant']);
  assert.equal(messages[2].tool_calls[0].function.name, 'echo');
  assert.equal(messages[3].content, 'yo');
  assert.match(events.find((e) => e.type === 'request/header').adapter, /mock/);
  fs.rmSync(ctx.home, { recursive: true, force: true });
});

test('AgentLoop: agent/pre-step reject 产生零 step turn，仍写 turn/end', async () => {
  const ctx = setup();
  ctx.events.on('agent/pre-step', async (payload, next) => {
    payload.rejected = true;
    payload.reason = 'blocked';
    await next();
  });
  const result = await ctx.loop.run(ctx.id, { input: 'go' });
  assert.equal(result.steps, 0);
  const events = ctx.sessions.events(ctx.id);
  assert.equal(events.at(-1).type, 'turn/end');
  assert.equal(events.filter((e) => e.type === 'assistant/message').length, 0);
  fs.rmSync(ctx.home, { recursive: true, force: true });
});

test('AgentLoop: maxSteps 截断且仍闭合 turn', async () => {
  const ctx = setup({
    maxSteps: 3,
    script: [{ text: 'again', toolCalls: [{ id: 'c1', name: 'echo', args: { text: 'x' } }] }],
  });
  const result = await ctx.loop.run(ctx.id, { input: 'go' });
  assert.equal(result.steps, 3);
  assert.equal(ctx.sessions.events(ctx.id).at(-1).type, 'turn/end');
  assert.deepEqual(ctx.sessions.missingToolResults(ctx.id), []);
  fs.rmSync(ctx.home, { recursive: true, force: true });
});

test('AgentLoop: 取消后无悬空 tool/call，cancelled=true', async () => {
  const ctx = setup();
  const controller = new AbortController();
  controller.abort();
  const result = await ctx.loop.run(ctx.id, { input: 'go', signal: controller.signal });
  assert.equal(result.steps, 0);
  assert.equal(result.cancelled, true);
  assert.equal(ctx.sessions.events(ctx.id).at(-1).type, 'turn/end');
  assert.deepEqual(ctx.sessions.missingToolResults(ctx.id), []);
  fs.rmSync(ctx.home, { recursive: true, force: true });
});

test('AgentLoop: 执行流水线抛错后补齐缺失 tool/result 并闭合 turn', async () => {
  const ctx = setup({
    script: [{ text: 'call', toolCalls: [{ id: 'c1', name: 'echo', args: { text: 'x' } }] }],
  });
  ctx.events.on('tools/execute', async () => { throw new Error('pipeline exploded'); });
  await assert.rejects(() => ctx.loop.run(ctx.id, { input: 'go' }), /pipeline exploded/);
  const events = ctx.sessions.events(ctx.id);
  assert.equal(events.at(-1).type, 'turn/end');
  assert.equal(events.filter((e) => e.type === 'tool/result').length, 1);
  assert.match(events.find((e) => e.type === 'tool/result').error, /missing after failed step/);
  assert.deepEqual(ctx.sessions.missingToolResults(ctx.id), []);
  fs.rmSync(ctx.home, { recursive: true, force: true });
});

test('AgentLoop: agent/request 可改写 model；run 事件流可 NDJSON 序列化', async () => {
  const seen = [];
  const ctx = setup({ script: [{ text: 'hi' }] });
  ctx.events.on('agent/request', async (payload, next) => {
    payload.request.model = 'rewritten-model';
    await next();
  });
  const result = await ctx.loop.run(ctx.id, { input: 'go', onEvent: (event) => seen.push(event) });
  assert.equal(result.text, 'hi');
  assert.equal(ctx.sessions.events(ctx.id).find((e) => e.type === 'request/header').model, 'rewritten-model');
  assert.equal(seen[0].type, 'run/start');
  assert.equal(seen.at(-1).type, 'run/end');
  assert.ok(seen.some((e) => e.type === 'assistant-stream' && e.delta === 'hi'));
  for (const event of seen) assert.equal(JSON.parse(JSON.stringify(event)).type, event.type);
  fs.rmSync(ctx.home, { recursive: true, force: true });
});

test('SystemPrompt: 工具 schema 与自定义分段进入 system/message，且不重复追加', async () => {
  const ctx = setup({ script: [{ text: 'ok' }] });
  ctx.prompt.add({ id: 'extra', text: 'EXTRA RULE' });
  await ctx.loop.run(ctx.id, { input: 'first' });
  const system = ctx.sessions.events(ctx.id).find((e) => e.type === 'system/message');
  assert.match(system.text, /EXTRA RULE/);
  assert.match(system.text, /可用工具/);
  assert.match(system.text, /"name": "echo"/);

  await ctx.loop.run(ctx.id, { input: 'second' });
  assert.equal(ctx.sessions.events(ctx.id).filter((e) => e.type === 'system/message').length, 1);
  assert.equal(ctx.sessions.events(ctx.id).filter((e) => e.type === 'user/message').length, 2);
  fs.rmSync(ctx.home, { recursive: true, force: true });
});
