import { createInterface } from 'node:readline';
import type { Context } from '../core/context.js';
import { describe } from '../core/errors.js';
import type { SessionStore } from '../session/store.js';
import type { AgentLoop } from '../agent/loop.js';
import { out } from '../util/log.js';
import { NAME, VERSION } from '../version.js';
import type { App, Runtime } from './runtime.js';

interface RpcRequest {
  id?: unknown;
  method?: unknown;
  params?: Record<string, unknown>;
}

async function handleRpc(request: unknown, runtime: Runtime, ctx: Context): Promise<Record<string, unknown>> {
  const req = (request && typeof request === 'object' ? request : {}) as RpcRequest;
  const id = req.id ?? null;
  const method = typeof req.method === 'string' ? req.method : '';
  const params = req.params ?? {};

  switch (method) {
    case 'initialize':
      return { jsonrpc: '2.0', id, result: { name: NAME, version: VERSION, profile: runtime.profileName } };
    case 'config.dump':
      return { jsonrpc: '2.0', id, result: runtime.composed };
    case 'session.list':
      return { jsonrpc: '2.0', id, result: ctx.get<SessionStore>('sessions').list() };
    case 'session.create': {
      const sessionId = ctx.get<SessionStore>('sessions').create('sdk').header.id;
      runtime.sessionId = sessionId;
      return { jsonrpc: '2.0', id, result: { sessionId } };
    }
    case 'session.run': {
      const task = typeof params.task === 'string' ? params.task : '';
      if (!task) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'params.task is required' } };
      const sessions = ctx.get<SessionStore>('sessions');
      let sessionId = typeof params.sessionId === 'string' ? params.sessionId : runtime.sessionId;
      if (sessionId) sessions.resume(sessionId);
      else sessionId = sessions.create(task.slice(0, 40)).header.id;
      runtime.sessionId = sessionId;
      const result = await ctx.get<AgentLoop>('agentLoop').run(sessionId, { input: task, maxSteps: runtime.maxSteps });
      return { jsonrpc: '2.0', id, result };
    }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method || '(empty)'}` } };
  }
}

/** stdio JSON-RPC 运行形态（sdk / sdk-minimal profile）。 */
export function createSdkApp(): App {
  return {
    id: 'sdk',
    async run(runtime: Runtime, ctx: Context): Promise<number> {
      const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let response: Record<string, unknown>;
        try {
          response = await handleRpc(JSON.parse(trimmed) as unknown, runtime, ctx);
        } catch (error) {
          response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: describe(error) } };
        }
        out(JSON.stringify(response));
      }
      return 0;
    },
  };
}
