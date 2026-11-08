import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { composeConfig, dumpConfig } from '../dist/config/compose.js';
import { configSchema } from '../dist/config/schema.js';
import { loadHomePatch, loadPatch, loadUserProfile, resetProfile } from '../dist/config/loader.js';
import { BUNDLES as REAL_BUNDLES } from '../dist/profiles/bundles.js';
import { PROFILES, getProfile, profileNames } from '../dist/profiles/index.js';
import { parseLauncher } from '../dist/cli.js';

const bundles = {
  'b-core': {
    name: 'b-core',
    rows: [
      { id: 'a', use: 'svc/a', config: { v: 1, nested: { x: 1 } } },
      { id: 'b', use: 'svc/b' },
    ],
  },
  'b-app': { name: 'b-app', rows: [{ id: 'app', use: 'app/x' }] },
};

const profile = {
  name: 'p',
  bundles: ['b-core', 'b-app'],
  patch: {
    name: 'p',
    ops: [{ op: 'replace', id: 'a', row: { id: 'a', use: 'svc/a', config: { v: 2 } } }],
  },
};

test('composeConfig: bundle 顺序决定行顺序，layer 可溯源', () => {
  const result = composeConfig({ profile, bundles });
  assert.deepEqual(result.rows.map((r) => r.id), ['a', 'b', 'app']);
  assert.deepEqual(result.layers, ['bundle:b-core', 'bundle:b-app', 'profile:p']);
  assert.equal(result.rows[2].layer, 'bundle:b-app');
  assert.equal(result.profile, 'p');
});

test('composeConfig: replace 是整体替换，不做深合并', () => {
  const result = composeConfig({ profile, bundles });
  assert.deepEqual(result.rows[0].config, { v: 2 });
  assert.equal('nested' in result.rows[0].config, false);
});

test('composeConfig: 层级优先级 bundle < profile < home < --patch；defaultOnly 跳过用户层', () => {
  const homePatch = {
    name: 'home',
    ops: [{ op: 'replace', id: 'a', row: { id: 'a', use: 'svc/home', config: { v: 3 } } }],
  };
  const cliPatches = [{
    name: 'cli.json',
    ops: [{ op: 'replace', id: 'a', row: { id: 'a', use: 'svc/cli', config: { v: 4 } } }],
  }];

  const full = composeConfig({ profile, bundles, homePatch, cliPatches });
  assert.equal(full.rows[0].use, 'svc/cli');
  assert.deepEqual(full.rows[0].config, { v: 4 });
  assert.deepEqual(full.layers.slice(-2), ['home', 'patch:cli.json']);

  const defaults = composeConfig({ profile, bundles, homePatch, cliPatches, defaultOnly: true });
  assert.equal(defaults.rows[0].use, 'svc/a');
  assert.equal(defaults.rows[0].config.v, 2);
  assert.equal(defaults.layers.includes('home'), false);
  assert.equal(defaults.layers.includes('patch:cli.json'), false);
});

test('composeConfig: insert before/after、remove 与 enabled=false', () => {
  const patch = {
    name: 'ops',
    ops: [
      { op: 'insert', row: { id: 'x', use: 'svc/x' }, after: 'a' },
      { op: 'insert', row: { id: 'y', use: 'svc/y' }, before: 'app' },
      { op: 'remove', id: 'b' },
      { op: 'insert', row: { id: 'z', use: 'svc/z', enabled: false } },
    ],
  };
  const result = composeConfig({ profile: { name: 'p', bundles: ['b-core', 'b-app'] }, bundles, cliPatches: [patch] });
  assert.deepEqual(result.rows.map((r) => r.id), ['a', 'x', 'y', 'app']);
  assert.equal(result.rows.some((r) => r.id === 'z'), false);
});

test('composeConfig: 未知 bundle / 未知 use 报错并带 hint', () => {
  assert.throws(
    () => composeConfig({ profile: { name: 'bad', bundles: ['nope'] }, bundles }),
    (e) => e.code === 'CFG_UNKNOWN_BUNDLE' && typeof e.hint === 'string',
  );
  assert.throws(
    () => composeConfig({ profile, bundles, knownUses: new Set(['svc/a', 'svc/b']) }),
    (e) => e.code === 'CFG_UNKNOWN_USE' && e.hint.includes('app/x'),
  );
  assert.doesNotThrow(() => composeConfig({ profile, bundles, knownUses: new Set(['svc/a', 'svc/b', 'app/x']) }));
});

test('composeConfig: profile.plugins 追加外挂插件行；同 id insert 会去重', () => {
  const result = composeConfig({
    profile: { ...profile, plugins: ['custom-plugin'] },
    bundles,
    cliPatches: [{ name: 'dup', ops: [{ op: 'insert', row: { id: 'a', use: 'svc/dup' } }] }],
  });
  assert.equal(result.rows.filter((r) => r.id === 'a').length, 1);
  assert.equal(result.rows[0].use, 'svc/dup');
  assert.ok(result.rows.some((r) => r.id === 'plugin:custom-plugin' && r.use === 'custom-plugin'));
});

test('内置 bundles / profiles 自洽，且每个 profile 都能组合出非空插件树', () => {
  assert.equal(Object.keys(REAL_BUNDLES).length, 7);
  assert.equal(profileNames().length, 6);
  for (const p of Object.values(PROFILES)) {
    for (const b of p.bundles) assert.ok(REAL_BUNDLES[b], `missing bundle ${b}`);
  }
  for (const bundle of Object.values(REAL_BUNDLES)) {
    const ids = bundle.rows.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate id in ${bundle.name}`);
    for (const r of bundle.rows) {
      assert.equal(typeof r.id, 'string');
      assert.equal(typeof r.use, 'string');
    }
  }
  assert.equal(PROFILES['sdk-minimal'].bundles.includes('dsh-base'), false, 'sdk-minimal 是刻意例外');
  assert.ok(PROFILES.web.bundles.includes('dsh-base'));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-dsh-cfg-'));
  for (const name of profileNames()) {
    const composed = composeConfig({ profile: getProfile(name, tmp), bundles: REAL_BUNDLES });
    assert.ok(composed.rows.length > 0, `${name} composed empty`);
    assert.ok(composed.rows.some((r) => r.id === 'app'), `${name} has no app row`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('loader: patch 文件两种形态、非法 JSON、home patch、自定义 profile 重置', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-dsh-cfg-'));
  const file = path.join(tmp, 'extra.json');

  fs.writeFileSync(file, JSON.stringify([{ op: 'replace', id: 'a', row: { id: 'a', use: 'svc/file' } }]));
  const arr = loadPatch(file);
  assert.equal(arr.name, 'extra.json');
  assert.equal(arr.ops.length, 1);

  fs.writeFileSync(file, JSON.stringify({ name: 'mine', ops: [{ op: 'remove', id: 'b' }] }));
  assert.equal(loadPatch(file).name, 'mine');

  fs.writeFileSync(file, '{not json');
  assert.throws(() => loadPatch(file), (e) => e.code === 'CFG_PATCH_INVALID');

  const home = path.join(tmp, 'home');
  fs.mkdirSync(path.join(home, 'profiles', 'tui'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'profiles', 'tui', 'cordis.patch.json'),
    JSON.stringify([{ op: 'remove', id: 'app' }]),
  );
  assert.equal(loadHomePatch(home, 'tui').ops[0].op, 'remove');
  assert.equal(loadHomePatch(home, 'web'), null);

  const saved = resetProfile(home, 'my-tui', PROFILES.tui);
  assert.equal(saved.name, 'my-tui');
  assert.deepEqual(saved.bundles, PROFILES.tui.bundles);
  assert.deepEqual(loadUserProfile(home, 'my-tui').bundles, PROFILES.tui.bundles);
  assert.deepEqual(getProfile('my-tui', home).bundles, PROFILES.tui.bundles);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('dumpConfig 输出合法 JSON；configSchema 含关键字段', () => {
  const result = composeConfig({ profile, bundles });
  const parsed = JSON.parse(dumpConfig(result));
  assert.equal(parsed.profile, 'p');
  assert.equal(parsed.rows.length, 3);
  const schema = configSchema();
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.ok(schema.properties.configRow);
  assert.ok(schema.properties.patch);
  assert.ok(schema.properties.patchFile);
});

test('parseLauncher: profile 定位、app 参数透传、重复 --patch', () => {
  const a = parseLauncher(['--profile', 'headless', '--json', 'run the tests']);
  assert.equal(a.profile, 'headless');
  assert.deepEqual(a.appArgs, ['--json', 'run the tests']);

  const b = parseLauncher(['web', '--dump-config', '--patch', 'a.json', '--patch', 'b.json']);
  assert.equal(b.profile, 'web');
  assert.equal(b.dumpConfig, true);
  assert.deepEqual(b.patchFiles, ['a.json', 'b.json']);

  assert.equal(parseLauncher(['--version']).version, true);
  assert.equal(parseLauncher(['--dump-config']).profile, 'headless');
  assert.deepEqual(parseLauncher(['headless', '--', '--weird']).appArgs, ['--weird']);
});
