import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ts-dsh-cli-'));
}

function runCli(args, opts = {}) {
  const home = opts.home ?? tmpHome();
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: home, DEEPSEEK_API_KEY: '', DSH_MODEL_ADAPTER: 'mock' },
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    timeout: 30_000,
  });
  return { ...result, home };
}

test('CLI: --version / --help', () => {
  const version = runCli(['--version']);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), '0.1.0');
  fs.rmSync(version.home, { recursive: true, force: true });

  const help = runCli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: dsh/);
  assert.match(help.stdout, /--dump-config/);
  fs.rmSync(help.home, { recursive: true, force: true });
});

test('CLI: --dump-config / --dump-default-config 输出合法组合树', () => {
  const web = runCli(['--profile', 'web', '--dump-config']);
  assert.equal(web.status, 0);
  const composed = JSON.parse(web.stdout);
  assert.equal(composed.profile, 'web');
  assert.ok(composed.rows.some((row) => row.use === 'app/web'));
  assert.ok(composed.rows.some((row) => row.use === 'core/agent-loop'));
  fs.rmSync(web.home, { recursive: true, force: true });

  const defaults = runCli(['--dump-default-config']);
  assert.equal(defaults.status, 0);
  assert.equal(JSON.parse(defaults.stdout).profile, 'headless');
  fs.rmSync(defaults.home, { recursive: true, force: true });

  const schema = runCli(['--dump-config-schema']);
  assert.equal(schema.status, 0);
  assert.ok(JSON.parse(schema.stdout).properties.configRow);
  fs.rmSync(schema.home, { recursive: true, force: true });
});

test('CLI: --patch 覆盖配置行并记录 layer', () => {
  const home = tmpHome();
  const patch = path.join(home, 'p.json');
  fs.writeFileSync(patch, JSON.stringify([
    { op: 'replace', id: 'agent-loop', row: { id: 'agent-loop', use: 'core/agent-loop', config: { maxSteps: 3 } } },
  ]));
  const r = runCli(['--profile', 'headless', '--patch', patch, '--dump-config'], { home });
  assert.equal(r.status, 0);
  const row = JSON.parse(r.stdout).rows.find((item) => item.id === 'agent-loop');
  assert.equal(row.config.maxSteps, 3);
  assert.equal(row.layer, 'patch:p.json');
  fs.rmSync(home, { recursive: true, force: true });
});

test('CLI: headless 离线跑通（无 API Key 自动回退 Mock）', () => {
  const r = runCli(['--profile', 'headless', 'hello from cli']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /MOCK: hello from cli/);
  fs.rmSync(r.home, { recursive: true, force: true });
});

test('CLI: headless --json 输出 NDJSON run 事件', () => {
  const r = runCli(['--profile', 'headless', '--json', 'json task']);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  const events = lines.map((line) => JSON.parse(line));
  assert.equal(events[0].type, 'run/start');
  assert.equal(events.at(-1).type, 'run/end');
  assert.equal(events.at(-1).text, 'MOCK: json task');
  assert.ok(events.some((event) => event.type === 'assistant-stream'));
  fs.rmSync(r.home, { recursive: true, force: true });
});

test('CLI: stdin(-) 读取任务；--session-id 续跑', () => {
  const home = tmpHome();
  const stdin = runCli(['--profile', 'headless', '-'], { home, input: 'stdin task\n' });
  assert.equal(stdin.status, 0, stdin.stderr);
  assert.match(stdin.stdout, /MOCK: stdin task/);

  const first = runCli(['--profile', 'headless', '--json', 'first'], { home });
  const events = first.stdout.trim().split('\n').map((line) => JSON.parse(line));
  const sessionId = events.find((event) => event.type === 'run/start').sessionId;

  const second = runCli(['--profile', 'headless', '--session-id', sessionId, 'second'], { home });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /MOCK: second/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('CLI: dsh plugin 子命令管理 profile 插件', () => {
  const home = tmpHome();
  const list0 = runCli(['plugin', '--profile', 'headless', 'list'], { home });
  assert.equal(list0.status, 0);
  assert.match(list0.stdout, /no extra plugins/);

  const add = runCli(['plugin', '--profile', 'headless', 'add', 'my-plugin'], { home });
  assert.equal(add.status, 0);
  assert.match(add.stdout, /added my-plugin/);
  assert.ok(fs.existsSync(path.join(home, 'profiles', 'headless', 'profile.json')));

  const list1 = runCli(['plugin', '--profile', 'headless', 'list'], { home });
  assert.match(list1.stdout, /my-plugin/);
  const why = runCli(['plugin', '--profile', 'headless', 'why', 'my-plugin'], { home });
  assert.match(why.stdout, /plugins 列表/);

  const remove = runCli(['plugin', '--profile', 'headless', 'remove', 'my-plugin'], { home });
  assert.equal(remove.status, 0);
  fs.rmSync(home, { recursive: true, force: true });
});

test('CLI: --from-default-profile 创建自定义 profile', () => {
  const home = tmpHome();
  const r = runCli(['--profile', 'my-tui', '--from-default-profile', 'tui', '--dump-config'], { home });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).profile, 'my-tui');
  assert.ok(fs.existsSync(path.join(home, 'profiles', 'my-tui', 'profile.json')));
  fs.rmSync(home, { recursive: true, force: true });
});

test('CLI: sdk profile 的 stdio JSON-RPC', () => {
  const home = tmpHome();
  const requests = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'config.dump' }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'session.run', params: { task: 'hello' } }),
  ].join('\n') + '\n';
  const r = runCli(['--profile', 'sdk'], { home, input: requests });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 3);
  assert.equal(lines[0].result.name, 'ts-dsh');
  assert.equal(lines[1].result.profile, 'sdk');
  assert.equal(lines[2].result.text, 'MOCK: hello');
  fs.rmSync(home, { recursive: true, force: true });
});

test('CLI: 未知 profile / 未知插件给出带错误码的诊断', () => {
  const home = tmpHome();
  const badProfile = runCli(['--profile', 'does-not-exist', 'hello'], { home });
  assert.equal(badProfile.status, 1);
  assert.match(badProfile.stderr, /CFG_UNKNOWN_PROFILE/);

  const patch = path.join(home, 'bad.json');
  fs.writeFileSync(patch, JSON.stringify([
    { op: 'insert', row: { id: 'ghost', use: 'not-registered' } },
  ]));
  const badUse = runCli(['--profile', 'headless', '--patch', patch, 'hello'], { home });
  assert.equal(badUse.status, 1);
  assert.match(badUse.stderr, /CFG_UNKNOWN_USE/);
  fs.rmSync(home, { recursive: true, force: true });
});
