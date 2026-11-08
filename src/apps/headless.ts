import type { Context } from '../core/context.js';
import { describe } from '../core/errors.js';
import type { SessionStore } from '../session/store.js';
import type { AgentLoop } from '../agent/loop.js';
import { err, out } from '../util/log.js';
import { headlessHelp, type App, type Runtime } from './runtime.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

/** 一次性任务：结果走 stdout，诊断走 stderr；--json 输出 NDJSON run 事件。 */
export function createHeadlessApp(): App {
  return {
    id: 'headless',
    async run(runtime: Runtime, ctx: Context): Promise<number> {
      if (runtime.options.help) {
        out(headlessHelp());
        return 0;
      }

      const sessions = ctx.get<SessionStore>('sessions');
      const loop = ctx.get<AgentLoop>('agentLoop');
      let task = runtime.options.task;
      if (runtime.options.readStdin || task === '-') task = await readStdin();
      if (!task) {
        err('APP_NO_TASK: 没有提供任务文本（可用位置参数、引号包裹的多词任务，或用 - 从 stdin 读取）');
        return 1;
      }

      let sessionId = runtime.options.sessionId ?? '';
      try {
        if (sessionId) sessions.resume(sessionId);
        else sessionId = sessions.create(task.slice(0, 40)).header.id;
      } catch (error) {
        err(describe(error));
        return 1;
      }
      runtime.sessionId = sessionId;

      try {
        const result = await loop.run(sessionId, {
          input: task,
          maxSteps: runtime.maxSteps,
          onEvent: (event) => {
            if (runtime.options.json) out(JSON.stringify(event));
          },
        });
        if (!runtime.options.json) out(result.text);
        return 0;
      } catch (error) {
        err(describe(error));
        return 1;
      }
    },
  };
}
