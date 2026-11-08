import type { Context } from '../core/context.js';
import type { Disposable } from '../core/types.js';
import type { Runtime } from '../apps/runtime.js';

export type CommandRunResult = string | { output: string; quit?: boolean };

export interface CommandContext {
  ctx: Context;
  runtime: Runtime;
}

/** 人工命令：斜杠前缀，由 UI 适配器分发，不进入模型消息。 */
export interface Command {
  name: string;
  description: string;
  usage?: string;
  run(args: string[], context: CommandContext): CommandRunResult | Promise<CommandRunResult>;
}

export interface DispatchResult {
  handled: boolean;
  output: string;
  quit: boolean;
}

/** ctx.commands：斜杠命令注册表。 */
export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  register(command: Command): Disposable {
    this.commands.set(command.name.toLowerCase(), command);
    return { dispose: () => { this.commands.delete(command.name.toLowerCase()); } };
  }

  list(): Command[] {
    return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  help(): string {
    const lines = ['可用命令：'];
    for (const command of this.list()) {
      lines.push(`  /${command.name}${command.usage ? ` ${command.usage}` : ''}  ${command.description}`);
    }
    return lines.join('\n');
  }

  async dispatch(line: string, context: CommandContext): Promise<DispatchResult> {
    const trimmed = line.trim();
    if (!trimmed.startsWith('/')) return { handled: false, output: '', quit: false };
    const parts = trimmed.slice(1).split(/\s+/).filter(Boolean);
    const name = (parts[0] ?? '').toLowerCase();
    const command = this.commands.get(name);
    if (!command) {
      return { handled: true, output: `未知命令 /${name}；输入 /help 查看可用命令。`, quit: false };
    }
    const result = await command.run(parts.slice(1), context);
    if (typeof result === 'string') return { handled: true, output: result, quit: false };
    return { handled: true, output: result.output, quit: Boolean(result.quit) };
  }
}
