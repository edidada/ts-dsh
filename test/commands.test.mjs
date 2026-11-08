import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Context } from '../dist/core/context.js';
import { SessionStore } from '../dist/session/store.js';
import { CommandRegistry } from '../dist/commands/registry.js';
import { registerBuiltinCommands } from '../dist/commands/builtin.js';
import { createRuntime, parseAppOptions } from '../dist/apps/runtime.js';
import { composeConfig } from '../dist/config/compose.js';
import { BUNDLES } from '../dist/profiles/bundles.js';
import { PROFILES } from '../dist/profiles/index.js';

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-dsh-cmd-'));
  const composed = composeConfig({ profile: PROFILES.headless, bundles: BUNDLES });
  const runtime = createRuntime({ home, profileName: 'headless', composed, appArgs: ['hello'] });
  const ctx = new Context();
  const sessions = new SessionStore(home);
  ctx.provide('sessions', sessions);
  ctx.provide('settings', { set() {} });
  const commands = new CommandRegistry();
  registerBuiltinCommands(commands, runtime, ctx);
  return { home, composed, runtime, ctx, sessions, commands };
}

test('CommandRegistry: 斜杠命令分发、未知命令、非斜杠不处理、quit', async () => {
  const ctx = setup();
  const context = { ctx: ctx.ctx, runtime: ctx.runtime };

  const help = await ctx.commands.dispatch('/help', context);
  assert.equal(help.handled, true);
  assert.match(help.output, /\/help/);
  assert.match(help.output, /\/quit/);

  const plain = await ctx.commands.dispatch('just a prompt', context);
  assert.equal(plain.handled, false);

  const unknown = await ctx.commands.dispatch('/nope', context);
  assert.equal(unknown.handled, true);
  assert.match(unknown.output, /未知命令/);

  const quit = await ctx.commands.dispatch('/quit', context);
  assert.equal(quit.quit, true);

  const version = await ctx.commands.dispatch('/version', context);
  assert.match(version.output, /ts-dsh 0\.1\.0/);

  const model = await ctx.commands.dispatch('/model gpt-x', context);
  assert.match(model.output, /gpt-x/);
  assert.equal(ctx.runtime.model, 'gpt-x');
  assert.match((await ctx.commands.dispatch('/model', context)).output, /gpt-x/);

  const dump = await ctx.commands.dispatch('/dump-config', context);
  assert.equal(JSON.parse(dump.output).profile, 'headless');
  fs.rmSync(ctx.home, { recursive: true, force: true });
});

test('人工命令不进入模型消息（durable 事件数不变）', async () => {
  const ctx = setup();
  const id = ctx.sessions.create().header.id;
  ctx.runtime.sessionId = id;
  const before = ctx.sessions.events(id).length;
  const context = { ctx: ctx.ctx, runtime: ctx.runtime };

  await ctx.commands.dispatch('/help', context);
  await ctx.commands.dispatch('/model x', context);
  await ctx.commands.dispatch('/sessions', context);
  await ctx.commands.dispatch('/dump-config', context);

  assert.equal(ctx.sessions.events(id).length, before);
  assert.equal(ctx.sessions.events(id).filter((e) => e.type === 'user/message').length, 0);
  fs.rmSync(ctx.home, { recursive: true, force: true });
});

test('/clear 开启新会话并更新 runtime.sessionId', async () => {
  const ctx = setup();
  const id = ctx.sessions.create().header.id;
  ctx.runtime.sessionId = id;
  const result = await ctx.commands.dispatch('/clear', { ctx: ctx.ctx, runtime: ctx.runtime });
  assert.notEqual(ctx.runtime.sessionId, id);
  assert.match(result.output, /新会话/);
  assert.ok(ctx.sessions.stat(ctx.runtime.sessionId));
  fs.rmSync(ctx.home, { recursive: true, force: true });
});

test('parseAppOptions: flag 与位置参数解析、非法枚举回退', () => {
  const plain = parseAppOptions(['--json', 'hello', 'world']);
  assert.equal(plain.task, 'hello world');
  assert.equal(plain.json, true);
  assert.equal(plain.readStdin, false);

  const full = parseAppOptions([
    '--session-id', 's-1', '--permission-mode', 'full-access',
    '--approval-policy', 'ask', '--add-dir', '/tmp/a', '--add-dir', '/tmp/b',
    '--port', '4000', '--host', '0.0.0.0', '--no-open', '-', 'run it',
  ]);
  assert.equal(full.sessionId, 's-1');
  assert.equal(full.permissionMode, 'full-access');
  assert.equal(full.approvalBehavior, 'ask');
  assert.deepEqual(full.addDirs, ['/tmp/a', '/tmp/b']);
  assert.equal(full.port, 4000);
  assert.equal(full.host, '0.0.0.0');
  assert.equal(full.noOpen, true);
  assert.equal(full.readStdin, true);
  assert.equal(full.task, 'run it');

  const bad = parseAppOptions(['--permission-mode', 'nonsense', '--approval-policy', 'maybe', 'x']);
  assert.equal(bad.permissionMode, 'read-only');
  assert.equal(bad.approvalBehavior, 'never');
  assert.equal(bad.task, 'x');
});
