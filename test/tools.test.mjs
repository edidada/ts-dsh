import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventBus } from '../dist/core/events.js';
import { newScopeKey } from '../dist/core/scope.js';
import { ToolRegistry } from '../dist/tools/registry.js';
import { ApprovalPolicy, permissionModes } from '../dist/tools/approval.js';
import { createBuiltinTools } from '../dist/tools/builtin.js';

function tool(name, risk = 'read', handler = () => name) {
  return { name, description: name, parameters: { type: 'object' }, risk, handler };
}

function tmpCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ts-dsh-tools-'));
}

test('ToolRegistry: register / list / schemas / scoped 影子 / restrict 交集', () => {
  const cwd = tmpCwd();
  const registry = new ToolRegistry(new EventBus(), cwd, 200);
  registry.register(tool('a'));
  registry.register(tool('b', 'write'));
  assert.deepEqual(registry.list().map((t) => t.name), ['a', 'b']);
  assert.equal(registry.schemas().length, 2);
  assert.equal(registry.schemas()[0].handler, undefined, 'schema 不暴露 handler');

  const scope = newScopeKey('agent-1');
  registry.register(tool('a', 'exec'), scope);
  assert.equal(registry.resolve('a', scope).risk, 'exec', 'scoped 覆盖同名 global');

  registry.restrict(scope, ['b']);
  assert.equal(registry.resolve('a', scope), undefined, '被过滤的工具不可解析');
  assert.equal(registry.resolve('b', scope).name, 'b');
  assert.equal(registry.has('a'), true, 'global 仍可见');
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('ToolRegistry: pre-execute 改写参数、execute 短路、post-execute 改写输出', async () => {
  const cwd = tmpCwd();
  const bus = new EventBus();
  const registry = new ToolRegistry(bus, cwd, 200);
  registry.register(tool('echo', 'read', (args) => String(args.text)));

  bus.on('tools/pre-execute', async (payload, next) => {
    payload.call.args.text = 'rewritten';
    await next();
  });
  bus.on('tools/post-execute', async (payload, next) => {
    payload.result = { ...payload.result, output: `post:${payload.result.output}` };
    await next();
  });

  const [result] = await registry.execute([{ callId: 'c1', name: 'echo', args: { text: 'orig' } }]);
  assert.equal(result.ok, true);
  assert.equal(result.output, 'post:rewritten');

  bus.on('tools/execute', async (payload, next) => {
    payload.output = 'short-circuit';
    await next();
  });
  const [short] = await registry.execute([{ callId: 'c2', name: 'echo', args: { text: 'x' } }]);
  assert.equal(short.output, 'post:short-circuit');
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('ToolRegistry: pre-execute 拒绝 / 未知工具 / 取消', async () => {
  const cwd = tmpCwd();
  const bus = new EventBus();
  const registry = new ToolRegistry(bus, cwd, 200);
  registry.register(tool('echo', 'read', (args) => String(args.text)));

  bus.on('tools/pre-execute', async (payload, next) => {
    payload.rejected = true;
    payload.reason = 'policy says no';
    await next();
  });
  const [rejected] = await registry.execute([{ callId: 'c1', name: 'echo', args: { text: 'x' } }]);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'policy says no');

  const [unknown] = await registry.execute([{ callId: 'c2', name: 'ghost', args: {} }]);
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /unknown tool|policy says no/);

  const controller = new AbortController();
  controller.abort();
  const [cancelled] = await registry.execute(
    [{ callId: 'c3', name: 'echo', args: { text: 'x' } }],
    { signal: controller.signal },
  );
  assert.equal(cancelled.ok, false);
  assert.match(cancelled.error, /cancelled/);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('ApprovalPolicy: 三种权限预设对 read/write/exec 的矩阵', () => {
  const cwd = tmpCwd();
  assert.deepEqual(permissionModes(), ['read-only', 'workspace-write', 'full-access']);
  const matrix = {
    'read-only': [true, false, false],
    'workspace-write': [true, true, false],
    'full-access': [true, true, true],
  };
  for (const [mode, expected] of Object.entries(matrix)) {
    const policy = new ApprovalPolicy({ mode, cwd });
    assert.deepEqual(
      ['read', 'write', 'exec'].map((risk) => policy.decide(tool('x', risk), {}).allowed),
      expected,
      mode,
    );
  }
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('ApprovalPolicy: ask 需预批准；写路径越界被拒', () => {
  const cwd = tmpCwd();
  const policy = new ApprovalPolicy({ mode: 'full-access', behavior: 'ask', cwd });
  const writer = tool('write_file', 'write');
  assert.equal(policy.decide(writer, {}).allowed, false);
  assert.match(policy.decide(writer, {}).reason, /approval required/);
  policy.allowTool('write_file');
  assert.equal(policy.decide(writer, {}).allowed, true);

  const roots = new ApprovalPolicy({ mode: 'workspace-write', cwd, writeRoots: [cwd] });
  assert.equal(roots.decide(writer, { path: '../outside.txt' }).allowed, false);
  assert.equal(roots.decide(writer, { path: 'inside.txt' }).allowed, true);
  roots.addWriteRoot(os.tmpdir());
  assert.equal(roots.roots().length, 2);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('审批策略通过 tools/pre-execute 事件注入（能力接缝）', async () => {
  const cwd = tmpCwd();
  const bus = new EventBus();
  const policy = new ApprovalPolicy({ mode: 'read-only', cwd });
  bus.on('tools/pre-execute', async (payload, next) => {
    if (payload.tool) {
      const decision = policy.decide(payload.tool, payload.call.args);
      if (!decision.allowed) {
        payload.rejected = true;
        payload.reason = decision.reason;
      }
    }
    await next();
  });
  const registry = new ToolRegistry(bus, cwd, 200);
  registry.register(tool('write_file', 'write', () => 'wrote'));
  const [result] = await registry.execute([{ callId: 'c1', name: 'write_file', args: { path: 'a.txt' } }]);
  assert.equal(result.ok, false);
  assert.match(result.error, /read-only/);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('ToolRegistry: 超时保护与并发限制', async () => {
  const cwd = tmpCwd();
  const slow = new ToolRegistry(new EventBus(), cwd, 30);
  slow.register(tool('slow', 'read', () => new Promise(() => {})));
  const [timedOut] = await slow.execute([{ callId: 'c1', name: 'slow', args: {} }]);
  assert.equal(timedOut.ok, false);
  assert.match(timedOut.error, /timed out/);

  let active = 0;
  let max = 0;
  const limited = new ToolRegistry(new EventBus(), cwd, 2000);
  limited.register(tool('x', 'read', async () => {
    active += 1;
    max = Math.max(max, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return 'ok';
  }));
  const results = await limited.execute(
    Array.from({ length: 6 }, (_, i) => ({ callId: `c${i}`, name: 'x', args: {} })),
    { concurrency: 2 },
  );
  assert.equal(results.length, 6);
  assert.ok(results.every((r) => r.ok));
  assert.equal(max, 2);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('内置工具: echo/now/list_dir/read_file/write_file/run_command 与路径越界', async () => {
  const cwd = tmpCwd();
  const registry = new ToolRegistry(new EventBus(), cwd, 5000);
  for (const builtin of createBuiltinTools(cwd)) registry.register(builtin);
  const run = (callId, name, args) => registry.execute([{ callId, name, args }]).then((r) => r[0]);

  assert.equal((await run('1', 'echo', { text: 'hi' })).output, 'hi');
  assert.match((await run('2', 'now', {})).output, /^\d{4}-\d{2}-\d{2}T/);

  fs.writeFileSync(path.join(cwd, 'a.txt'), 'content-A');
  assert.equal((await run('3', 'read_file', { path: 'a.txt' })).output, 'content-A');

  const write = await run('4', 'write_file', { path: 'sub/b.txt', content: 'B' });
  assert.equal(write.ok, true);
  assert.equal(fs.readFileSync(path.join(cwd, 'sub', 'b.txt'), 'utf8'), 'B');

  const list = await run('5', 'list_dir', { path: '.' });
  assert.match(list.output, /a\.txt/);
  assert.match(list.output, /sub/);

  const cmd = await run('6', 'run_command', {
    command: process.execPath,
    args: ['-e', 'process.stdout.write("NODEOK")'],
  });
  assert.equal(cmd.ok, true);
  assert.match(cmd.output, /NODEOK/);

  const escaped = await run('7', 'read_file', { path: '../outside.txt' });
  assert.equal(escaped.ok, false);
  fs.rmSync(cwd, { recursive: true, force: true });
});
