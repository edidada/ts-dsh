import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { boot } from '../dist/cli.js';
import { composeConfig } from '../dist/config/compose.js';
import { BUNDLES } from '../dist/profiles/bundles.js';
import { PROFILES } from '../dist/profiles/index.js';
import { createRuntime } from '../dist/apps/runtime.js';
import { createWebHandler } from '../dist/apps/web.js';

process.env.DSH_MODEL_ADAPTER = 'mock';

test('Web handler: / /api/health /api/config /api/run /api/sessions / 404 / 413', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-dsh-web-'));
  const composed = composeConfig({ profile: PROFILES.web, bundles: BUNDLES });
  const runtime = createRuntime({ home, profileName: 'web', composed, appArgs: [] });
  const { ctx, host } = await boot(runtime, composed);
  const server = http.createServer(createWebHandler(runtime, ctx));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /ts-dsh web/);

    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.name, 'ts-dsh');
    assert.equal(health.profile, 'web');

    const config = await (await fetch(`${base}/api/config`)).json();
    assert.equal(config.profile, 'web');
    assert.ok(config.rows.some((row) => row.use === 'app/web'));

    const run = await (await fetch(`${base}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'hello' }),
    })).json();
    assert.equal(run.text, 'MOCK: hello');
    assert.match(run.sessionId, /^session-/);

    const sessions = await (await fetch(`${base}/api/sessions`)).json();
    assert.ok(sessions.sessions.some((header) => header.id === run.sessionId));

    const badJson = await fetch(`${base}/api/run`, { method: 'POST', body: 'not json' });
    assert.equal(badJson.status, 400);

    const missing = await fetch(`${base}/nope`);
    assert.equal(missing.status, 404);

    const tooBig = await fetch(`${base}/api/run`, { method: 'POST', body: 'x'.repeat(1024 * 1024 + 10) });
    assert.equal(tooBig.status, 413);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    host.dispose();
    ctx.dispose();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
