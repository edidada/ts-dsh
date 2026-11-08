import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionStore } from '../dist/session/store.js';
import { deriveMessages, lastAssistantText, missingToolResults } from '../dist/session/projection.js';
import { generationFile, latestGeneration, sessionDir } from '../dist/session/jsonl.js';

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ts-dsh-session-'));
}

test('SessionStore: create 写入 session/created，append 保证 seq 单调、ts 有序', () => {
  const home = tmpHome();
  const store = new SessionStore(home);
  const created = store.create('demo');
  const id = created.header.id;
  assert.match(id, /^session-/);
  assert.equal(created.header.eventCount, 1);

  store.append(id, { type: 'turn/start', turnId: 't1' });
  store.append(id, { type: 'user/message', text: 'hi' });
  const events = store.events(id);
  assert.deepEqual(events.map((e) => e.seq), [1, 2, 3]);
  assert.equal(events[0].type, 'session/created');
  assert.ok(events[1].ts >= events[0].ts);
  assert.equal(store.replay(id).openTurn, 't1');
  assert.equal(store.replay(id).currentStep, 0);
  fs.rmSync(home, { recursive: true, force: true });
});

test('SessionStore: JSONL 往返，重开进程后事件一致', () => {
  const home = tmpHome();
  const store = new SessionStore(home);
  const id = store.create().header.id;
  store.append(id, { type: 'turn/start', turnId: 't1' });
  store.append(id, { type: 'user/message', text: 'hello' });
  store.append(id, { type: 'turn/end', turnId: 't1' });

  const reopened = new SessionStore(home);
  const events = reopened.events(id);
  assert.equal(events.length, 4);
  assert.equal(events[2].text, 'hello');
  assert.equal(reopened.header(id).eventCount, 4);
  assert.equal(reopened.replay(id).openTurn, null);
  fs.rmSync(home, { recursive: true, force: true });
});

test('SessionStore: 截断尾行被修复且可继续 append', () => {
  const home = tmpHome();
  const store = new SessionStore(home);
  const id = store.create().header.id;
  store.append(id, { type: 'turn/start', turnId: 't1' });
  store.append(id, { type: 'user/message', text: 'ok' });
  const file = generationFile(sessionDir(home, id), 1);
  fs.appendFileSync(file, '{"type":"user/message","text":"bro');

  const reopened = new SessionStore(home);
  assert.equal(reopened.events(id).length, 3);
  assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 3);

  reopened.append(id, { type: 'turn/end', turnId: 't1' });
  const again = new SessionStore(home);
  assert.equal(again.events(id).length, 4);
  assert.equal(again.events(id)[3].type, 'turn/end');
  assert.equal(again.replay(id).openTurn, null);
  fs.rmSync(home, { recursive: true, force: true });
});

test('projection: deriveMessages 角色/tool_calls 映射，attempt 与 request 不入历史', () => {
  const home = tmpHome();
  const store = new SessionStore(home);
  const id = store.create().header.id;
  store.append(id, { type: 'turn/start', turnId: 't' });
  store.append(id, { type: 'system/message', text: 'SYS' });
  store.append(id, { type: 'user/message', text: 'hello' });
  store.append(id, { type: 'request/header', model: 'm', adapter: 'mock', reason: 'step' });
  store.append(id, { type: 'assistant/attempt', reason: 'cancelled' });
  store.append(id, {
    type: 'assistant/message',
    content: { text: 'thinking', toolCalls: [{ id: 'c1', name: 'echo', args: { text: 'hi' } }] },
  });
  store.append(id, { type: 'tool/call', callId: 'c1', name: 'echo', args: { text: 'hi' } });
  store.append(id, { type: 'tool/result', callId: 'c1', ok: true, output: 'hi' });
  store.append(id, { type: 'assistant/message', content: { text: 'done', toolCalls: [] } });
  store.append(id, { type: 'turn/end', turnId: 't' });

  const messages = store.deriveMessages(id);
  assert.deepEqual(messages.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'assistant']);
  assert.equal(messages[0].content, 'SYS');
  assert.equal(messages[2].tool_calls.length, 1);
  assert.equal(messages[2].tool_calls[0].type, 'function');
  assert.equal(messages[2].tool_calls[0].function.name, 'echo');
  assert.equal(JSON.parse(messages[2].tool_calls[0].function.arguments).text, 'hi');
  assert.equal(messages[3].tool_call_id, 'c1');
  assert.equal(messages[3].name, 'echo');
  assert.equal(lastAssistantText(store.events(id)), 'done');
  assert.deepEqual(missingToolResults(store.events(id)), []);

  store.append(id, { type: 'tool/call', callId: 'c9', name: 'x', args: {} });
  assert.deepEqual(missingToolResults(store.events(id)), [{ callId: 'c9', name: 'x' }]);
  fs.rmSync(home, { recursive: true, force: true });
});

test('SessionStore: fork 默认在最后一个 turn 边界，源文件不被改写', () => {
  const home = tmpHome();
  const store = new SessionStore(home);
  const id = store.create('source').header.id;
  store.append(id, { type: 'turn/start', turnId: 't1' });
  store.append(id, { type: 'user/message', text: 'a' });
  store.append(id, { type: 'assistant/message', content: { text: 'ans', toolCalls: [] } });
  store.append(id, { type: 'turn/end', turnId: 't1' });
  store.append(id, { type: 'turn/start', turnId: 't2' });
  const sourceCount = store.events(id).length;

  const forked = store.fork(id);
  assert.notEqual(forked.header.id, id);
  assert.equal(forked.header.forkedFrom, id);
  assert.equal(forked.events.length, 5);
  assert.equal(forked.events.at(-1).type, 'turn/end');
  assert.equal(forked.events[0].sessionId, forked.header.id);
  assert.equal(store.events(id).length, sourceCount, '源会话未被改写');

  const atThree = store.fork(id, 3);
  assert.equal(atThree.events.length, 3);
  assert.equal(atThree.header.forkAtSeq, 3);
  fs.rmSync(home, { recursive: true, force: true });
});

test('SessionStore: resume 发布新代际，旧代际文件保持不变', () => {
  const home = tmpHome();
  const store = new SessionStore(home);
  const id = store.create().header.id;
  store.append(id, { type: 'user/message', text: 'before' });
  const dir = sessionDir(home, id);
  const before = latestGeneration(dir);
  const oldContent = fs.readFileSync(generationFile(dir, before), 'utf8');

  const resumed = store.resume(id);
  assert.equal(resumed.generation, before + 1);
  assert.equal(latestGeneration(dir), before + 1);

  store.append(id, { type: 'user/message', text: 'after resume' });
  const fresh = new SessionStore(home);
  assert.equal(fresh.events(id).at(-1).text, 'after resume');
  assert.equal(fs.readFileSync(generationFile(dir, before), 'utf8'), oldContent);
  fs.rmSync(home, { recursive: true, force: true });
});

test('SessionStore: search / stat / list / 未知会话 / 未来格式', () => {
  const home = tmpHome();
  const store = new SessionStore(home);
  const id = store.create('searchable').header.id;
  store.append(id, { type: 'user/message', text: 'needle in haystack' });

  assert.equal(store.search(id, 'NEEDLE').length, 1);
  assert.equal(store.search(id, 'absent').length, 0);
  assert.equal(store.stat(id).eventCount, store.events(id).length);
  assert.ok(store.list().some((h) => h.id === id));
  assert.equal(store.stat('missing'), null);

  assert.throws(
    () => new SessionStore(home).open('session-does-not-exist'),
    (e) => e.code === 'SES_SESSION_NOT_FOUND' && typeof e.hint === 'string',
  );

  const futureHome = tmpHome();
  const futureId = new SessionStore(futureHome).create().header.id;
  const futureDir = sessionDir(futureHome, futureId);
  const headerPath = path.join(futureDir, 'header.json');
  const header = JSON.parse(fs.readFileSync(headerPath, 'utf8'));
  header.format = 99;
  fs.writeFileSync(headerPath, JSON.stringify(header));
  assert.throws(
    () => new SessionStore(futureHome).open(futureId),
    (e) => e.code === 'SES_FUTURE_VERSION',
  );

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(futureHome, { recursive: true, force: true });
});
