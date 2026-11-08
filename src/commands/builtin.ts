import type { Context } from '../core/context.js';
import type { Runtime } from '../apps/runtime.js';
import type { SessionStore } from '../session/store.js';
import type { CommandRegistry } from './registry.js';
import { VERSION } from '../version.js';

/** 注册内置斜杠命令；注册产生的副作用交给调用方按需回滚。 */
export function registerBuiltinCommands(registry: CommandRegistry, runtime: Runtime, ctx: Context): void {
  registry.register({
    name: 'help',
    description: '显示所有人工命令',
    run: () => registry.help(),
  });

  registry.register({
    name: 'model',
    usage: '[id]',
    description: '查看或切换当前模型',
    run: (args) => {
      if (args.length > 0) {
        runtime.model = args[0]!;
        ctx.peek<{ set(key: string, value: unknown): void }>('settings')?.set('model', runtime.model);
      }
      return `当前模型：${runtime.model}`;
    },
  });

  registry.register({
    name: 'session',
    description: '显示当前会话',
    run: () => {
      const sessions = ctx.get<SessionStore>('sessions');
      const header = runtime.sessionId ? sessions.stat(runtime.sessionId) : null;
      return header
        ? `session ${header.id} · ${header.eventCount} events · generation ${header.generation}`
        : '当前没有活动会话';
    },
  });

  registry.register({
    name: 'sessions',
    description: '列出已持久化的会话',
    run: () => {
      const sessions = ctx.get<SessionStore>('sessions');
      const list = sessions.list();
      return list.length === 0
        ? '没有会话'
        : list.map((header) => `${header.id}  ${header.eventCount} events`).join('\n');
    },
  });

  registry.register({
    name: 'clear',
    description: '开启一个新会话',
    run: () => {
      const sessions = ctx.get<SessionStore>('sessions');
      runtime.sessionId = sessions.create('tui').header.id;
      return `新会话：${runtime.sessionId}`;
    },
  });

  registry.register({
    name: 'dump-config',
    description: '打印当前组合出的插件树',
    run: () => JSON.stringify(runtime.composed, null, 2),
  });

  registry.register({
    name: 'version',
    description: '显示版本',
    run: () => `ts-dsh ${VERSION}`,
  });

  registry.register({
    name: 'quit',
    description: '退出 TUI',
    run: () => ({ output: 'bye', quit: true }),
  });
}
