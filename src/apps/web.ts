import * as http from 'node:http';
import type { Context } from '../core/context.js';
import { describe } from '../core/errors.js';
import type { SessionStore } from '../session/store.js';
import type { AgentLoop } from '../agent/loop.js';
import { err, out } from '../util/log.js';
import { NAME, VERSION } from '../version.js';
import type { App, Runtime } from './runtime.js';

export type WebHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

const HTML = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>ts-dsh web</title>
<style>body{font-family:system-ui,monospace;max-width:760px;margin:40px auto;padding:0 16px}
h1{font-size:20px}input,button{font:inherit;padding:8px}#out{white-space:pre-wrap;background:#f5f5f5;padding:12px;margin-top:16px}</style>
</head><body>
<h1>ts-dsh · web profile</h1>
<p>本地调试界面：<code>POST /api/run</code>，或 <a href="/api/health">/api/health</a>、<a href="/api/config">/api/config</a>。</p>
<input id="task" size="48" placeholder="输入任务，例如 hello"><button id="go">运行</button>
<div id="out"></div>
<script>
document.getElementById('go').onclick = async () => {
  const task = document.getElementById('task').value;
  const res = await fetch('/api/run', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({task})});
  document.getElementById('out').textContent = JSON.stringify(await res.json(), null, 2);
};
</script></body></html>`;

const BODY_LIMIT = 1024 * 1024;

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > BODY_LIMIT) throw new Error('request body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** 导出纯 handler，便于离线单测（不强制启动长驻服务）。 */
export function createWebHandler(runtime: Runtime, ctx: Context): WebHandler {
  return (req, res) => {
    void handle(req, res, runtime, ctx).catch((error: unknown) => {
      sendJson(res, 500, { error: describe(error) });
    });
  };
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, runtime: Runtime, ctx: Context): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'GET' && path === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }
  if (method === 'GET' && path === '/api/health') {
    sendJson(res, 200, { ok: true, name: NAME, version: VERSION, profile: runtime.profileName });
    return;
  }
  if (method === 'GET' && path === '/api/config') {
    sendJson(res, 200, runtime.composed);
    return;
  }
  if (method === 'GET' && path === '/api/sessions') {
    sendJson(res, 200, { sessions: ctx.get<SessionStore>('sessions').list() });
    return;
  }
  if (method === 'POST' && path === '/api/run') {
    let raw: string;
    try {
      raw = await readBody(req);
    } catch {
      sendJson(res, 413, { error: 'request body too large' });
      return;
    }
    let payload: { task?: unknown; sessionId?: unknown };
    try {
      payload = JSON.parse(raw) as { task?: unknown; sessionId?: unknown };
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
    const task = typeof payload.task === 'string' ? payload.task : '';
    if (!task) {
      sendJson(res, 400, { error: 'task is required' });
      return;
    }
    const sessions = ctx.get<SessionStore>('sessions');
    const loop = ctx.get<AgentLoop>('agentLoop');
    let sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
    if (sessionId) sessions.resume(sessionId);
    else sessionId = sessions.create(task.slice(0, 40)).header.id;
    runtime.sessionId = sessionId;
    const result = await loop.run(sessionId, { input: task, maxSteps: runtime.maxSteps });
    sendJson(res, 200, { sessionId, ...result });
    return;
  }
  sendJson(res, 404, { error: 'not found' });
}

/** Web 运行形态：本地 HTTP 服务（默认 127.0.0.1:3080）。 */
export function createWebApp(): App {
  return {
    id: 'web',
    async run(runtime: Runtime, ctx: Context): Promise<number> {
      const server = http.createServer(createWebHandler(runtime, ctx));
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(runtime.options.port, runtime.options.host, () => resolve());
      });
      out(`ts-dsh web listening at http://${runtime.options.host}:${runtime.options.port}`);
      if (!runtime.options.noOpen) {
        err('提示：本地桌面可自动打开浏览器；SSH/CI 下请直接访问上面的 URL。');
      }
      return new Promise<number>((resolve) => {
        const stop = (): void => { server.close(() => resolve(0)); };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
        server.on('close', () => resolve(0));
      });
    },
  };
}
