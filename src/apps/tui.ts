import { createInterface } from 'node:readline';
import type { Context } from '../core/context.js';
import { describe } from '../core/errors.js';
import type { SessionStore } from '../session/store.js';
import type { AgentLoop } from '../agent/loop.js';
import type { CommandRegistry } from '../commands/registry.js';
import { err, out } from '../util/log.js';
import { NAME, VERSION } from '../version.js';
import type { App, Runtime } from './runtime.js';

/** 交互式 REPL：斜杠命令不进模型消息；流式增量直接写 stdout。 */
export function createTuiApp(): App {
  return {
    id: 'tui',
    async run(runtime: Runtime, ctx: Context): Promise<number> {
      const sessions = ctx.get<SessionStore>('sessions');
      const loop = ctx.get<AgentLoop>('agentLoop');
      const commands = ctx.get<CommandRegistry>('commands');

      let sessionId = runtime.options.sessionId ?? '';
      if (sessionId) sessions.resume(sessionId);
      else sessionId = sessions.create('tui').header.id;
      runtime.sessionId = sessionId;

      const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
      out(`${NAME} ${VERSION} · profile ${runtime.profileName} · session ${sessionId}`);
      out('输入 /help 查看命令，Ctrl+C 退出。');
      let quitting = false;

      return new Promise<number>((resolve) => {
        rl.setPrompt('dsh> ');
        rl.prompt();
        rl.on('line', (line: string) => {
          void (async () => {
            const trimmed = line.trim();
            if (!trimmed) return;
            rl.pause();
            try {
              if (trimmed.startsWith('/')) {
                const result = await commands.dispatch(trimmed, { ctx, runtime });
                if (result.output) out(result.output);
                if (result.quit) {
                  quitting = true;
                  rl.close();
                }
              } else {
                const result = await loop.run(sessionId, {
                  input: trimmed,
                  maxSteps: runtime.maxSteps,
                  onEvent: (event) => {
                    if (event.type === 'assistant-stream') process.stdout.write(event.delta);
                  },
                });
                out('');
                out(`[${result.steps} step(s)]`);
              }
            } catch (error) {
              err(describe(error));
            } finally {
              if (!quitting) {
                rl.resume();
                rl.prompt();
              }
            }
          })();
        });
        rl.on('close', () => resolve(0));
      });
    },
  };
}
