import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '../dist/core/context.js';
import { EventBus } from '../dist/core/events.js';
import { PluginHost } from '../dist/core/plugin.js';
import { newScopeKey, resolveScoped, scopeLabel } from '../dist/core/scope.js';
import { DshError } from '../dist/core/errors.js';

test('Context: provide / get / peek / has / serviceKeys', () => {
  const ctx = new Context();
  assert.equal(ctx.has('llm'), false);
  assert.equal(ctx.peek('llm'), undefined);
  assert.throws(() => ctx.get('llm'), (e) => e instanceof DshError && e.code === 'PLG_SERVICE_MISSING');

  const handle = ctx.provide('llm', { id: 'mock' });
  assert.equal(ctx.get('llm').id, 'mock');
  assert.deepEqual(ctx.serviceKeys(), ['llm']);

  handle.dispose();
  assert.equal(ctx.has('llm'), false);
  ctx.dispose();
});

test('Context: dispose 逆序回滚且幂等', () => {
  const ctx = new Context();
  const order = [];
  ctx.onDispose(() => order.push('first'));
  ctx.onDispose(() => order.push('second'));
  ctx.onDispose(() => order.push('third'));
  ctx.dispose();
  ctx.dispose();
  assert.deepEqual(order, ['third', 'second', 'first']);
  assert.throws(() => ctx.get('anything'), (e) => e.code === 'PLG_CONTEXT_DISPOSED');
});

test('Context: onDispose 句柄可提前撤销且只执行一次', () => {
  const ctx = new Context();
  let calls = 0;
  const handle = ctx.onDispose(() => { calls += 1; });
  handle.dispose();
  handle.dispose();
  ctx.dispose();
  assert.equal(calls, 1);
});

test('Context: waitFor 等依赖，onService 收到 added/removed', async () => {
  const ctx = new Context();
  const kinds = [];
  ctx.onService('llm', (kind) => kinds.push(kind));
  const pending = ctx.waitFor('llm');
  const handle = ctx.provide('llm', { id: 'mock' });
  const value = await pending;
  assert.equal(value.id, 'mock');
  assert.deepEqual(kinds, ['added']);

  handle.dispose();
  assert.equal(ctx.has('llm'), false);
  assert.deepEqual(kinds, ['added', 'removed']);

  // 已就绪时立即 resolve
  ctx.provide('llm', { id: 'late' });
  assert.equal((await ctx.waitFor('llm')).id, 'late');
  ctx.dispose();
});

test('Context: scoped 共享注册表但携带独立 scope key', () => {
  const ctx = new Context();
  ctx.provide('tools', { count: 1 });
  const scope = newScopeKey('agent-1');
  const child = ctx.scoped(scope);
  assert.equal(child.scope, scope);
  assert.equal(ctx.scope, undefined);
  assert.equal(child.get('tools').count, 1);
  assert.equal(child.events, ctx.events);
  assert.equal(scopeLabel(scope), 'agent-1');
  assert.equal(scopeLabel(undefined), 'global');
  ctx.dispose();
});

test('EventBus: waterfall 改写载荷、serial 自动委托、next 截断', async () => {
  const bus = new EventBus();
  const calls = [];
  bus.on('x', async (payload, next) => {
    calls.push('a');
    payload.value += 1;
    await next();
    calls.push('a-end');
  });
  bus.on('x', async (payload, next) => {
    calls.push('b');
    payload.value += 10;
    await next();
  });
  bus.onSerial('x', (payload) => {
    calls.push('c');
    payload.value += 100;
  });
  const payload = { value: 0 };
  const returned = await bus.emit('x', payload);
  assert.equal(returned, payload);
  assert.equal(payload.value, 111);
  assert.deepEqual(calls, ['a', 'b', 'c', 'a-end']);
  assert.equal(bus.listenerCount('x'), 3);

  const bus2 = new EventBus();
  const hits = [];
  bus2.on('y', () => { hits.push('first'); }); // 不调用 next，链截断
  bus2.onSerial('y', () => { hits.push('second'); });
  await bus2.emit('y', {});
  assert.deepEqual(hits, ['first']);
});

test('resolveScoped: restrict 交集过滤 + scoped 影子覆盖', () => {
  const globals = new Map([
    ['read', 'g-read'],
    ['write', 'g-write'],
    ['exec', 'g-exec'],
  ]);
  const scope = newScopeKey('agent-1');
  const scoped = new Map([[scope, new Map([['read', 's-read']])]]);

  const result = resolveScoped(globals, scoped, scope, new Set(['read', 'exec']));
  assert.deepEqual([...result.entries()], [['read', 's-read'], ['exec', 'g-exec']]);

  const noScope = resolveScoped(globals, scoped, undefined);
  assert.deepEqual([...noScope.keys()], ['read', 'write', 'exec']);
});

test('PluginHost: mount / unmount 逆序回滚，服务与监听不残留', async () => {
  const ctx = new Context();
  const factories = new Map();
  factories.set('svc/a', (c) => {
    c.provide('a', 1);
    const handle = c.events.onSerial('evt', () => {});
    c.onDispose(() => handle.dispose());
  });
  const host = new PluginHost(ctx, factories);
  await host.boot([{ id: 'a-row', use: 'svc/a' }]);
  assert.equal(ctx.has('a'), true);
  assert.equal(ctx.events.listenerCount('evt'), 1);
  assert.deepEqual(host.list(), [{ id: 'a-row', use: 'svc/a' }]);

  host.unmount('a-row');
  assert.equal(ctx.has('a'), false);
  assert.equal(ctx.events.listenerCount('evt'), 0);
  assert.equal(host.has('a-row'), false);
  ctx.dispose();
});

test('PluginHost: 工厂返回 Disposable 时卸载会执行 dispose', async () => {
  const ctx = new Context();
  let disposed = false;
  const factories = new Map([['svc/b', () => ({ dispose: () => { disposed = true; } })]]);
  const host = new PluginHost(ctx, factories);
  await host.mount({ id: 'b-row', use: 'svc/b' });
  host.unmount('b-row');
  assert.equal(disposed, true);
  ctx.dispose();
});

test('PluginHost: 未知 use 报错带 hint；挂载抛错时回滚已产生的副作用', async () => {
  const ctx = new Context();
  const factories = new Map();
  factories.set('svc/bad', (c) => {
    c.provide('bad', 1);
    throw new Error('boom');
  });
  const host = new PluginHost(ctx, factories);

  await assert.rejects(
    () => host.mount({ id: 'missing', use: 'nope' }),
    (e) => e instanceof DshError && e.code === 'PLG_UNKNOWN_FACTORY' && typeof e.hint === 'string',
  );
  await assert.rejects(() => host.mount({ id: 'bad', use: 'svc/bad' }), /boom/);
  assert.equal(ctx.has('bad'), false);
  ctx.dispose();
});
