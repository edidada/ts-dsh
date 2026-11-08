import type { Context } from '../core/context.js';
import type { ComposeResult } from '../config/types.js';
import type { ApprovalBehavior, PermissionMode } from '../tools/approval.js';
import { permissionModes } from '../tools/approval.js';
import { envInt, envStr } from '../util/env.js';

export interface AppOptions {
  task: string;
  json: boolean;
  sessionId?: string;
  permissionMode: PermissionMode;
  approvalBehavior: ApprovalBehavior;
  addDirs: string[];
  port: number;
  host: string;
  noOpen: boolean;
  help: boolean;
  readStdin: boolean;
}

/** 解析启动器之后、交给 app 的参数。 */
export function parseAppOptions(args: string[]): AppOptions {
  const positional: string[] = [];
  const addDirs: string[] = [];
  let json = false;
  let sessionId: string | undefined;
  let permissionMode: PermissionMode = 'read-only';
  let approvalBehavior: ApprovalBehavior = 'never';
  let port = 3080;
  let host = '127.0.0.1';
  let noOpen = false;
  let help = false;
  let readStdin = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--json') { json = true; continue; }
    if (arg === '--session-id' || arg === '--resume') { sessionId = args[++i] ?? ''; continue; }
    if (arg === '--permission-mode') { permissionMode = (args[++i] ?? '') as PermissionMode; continue; }
    if (arg === '--approval-policy') { approvalBehavior = (args[++i] ?? '') as ApprovalBehavior; continue; }
    if (arg === '--add-dir') { addDirs.push(args[++i] ?? ''); continue; }
    if (arg === '--port') { port = Number(args[++i]) || 3080; continue; }
    if (arg === '--host') { host = args[++i] || '127.0.0.1'; continue; }
    if (arg === '--no-open') { noOpen = true; continue; }
    if (arg === '-h' || arg === '--help') { help = true; continue; }
    if (arg === '-') { readStdin = true; continue; }
    positional.push(arg);
  }

  if (!permissionModes().includes(permissionMode)) permissionMode = 'read-only';
  if (approvalBehavior !== 'ask' && approvalBehavior !== 'never') approvalBehavior = 'never';

  return {
    task: positional.join(' ').trim(),
    json,
    ...(sessionId ? { sessionId } : {}),
    permissionMode,
    approvalBehavior,
    addDirs: addDirs.filter(Boolean),
    port,
    host,
    noOpen,
    help,
    readStdin,
  };
}

/** 一次运行的共享状态，插件工厂与 app 都通过它读取配置。 */
export interface Runtime {
  home: string;
  cwd: string;
  profileName: string;
  composed: ComposeResult;
  appArgs: string[];
  options: AppOptions;
  sessionId: string;
  model: string;
  maxSteps: number;
  permissionMode: PermissionMode;
  approvalBehavior: ApprovalBehavior;
  writeRoots: string[];
}

/** 应用插件：也是配置树里的一行，通过 ctx.app 暴露。 */
export interface App {
  id: string;
  run(runtime: Runtime, ctx: Context): Promise<number>;
}

export function createRuntime(params: {
  home: string;
  cwd?: string;
  profileName: string;
  composed: ComposeResult;
  appArgs: string[];
}): Runtime {
  const options = parseAppOptions(params.appArgs);
  const cwd = params.cwd ?? process.cwd();
  return {
    home: params.home,
    cwd,
    profileName: params.profileName,
    composed: params.composed,
    appArgs: params.appArgs,
    options,
    sessionId: options.sessionId ?? '',
    model: envStr('DSH_MODEL', 'deepseek-chat'),
    maxSteps: envInt('DSH_MAX_STEPS', 8),
    permissionMode: options.permissionMode,
    approvalBehavior: options.approvalBehavior,
    writeRoots: [cwd, ...options.addDirs],
  };
}

export function headlessHelp(): string {
  return `Usage: dsh --profile headless [options] [task...]

Answer one task and exit; the answer goes to stdout and diagnostics to stderr.

Arguments:
  task                        the task text; multiple words are joined by spaces, and - reads stdin

Options:
  --json                      write newline-delimited run events to stdout
  --session-id <id>           adopt the persisted Session with this id
  --permission-mode <preset>  read-only | workspace-write | full-access
  --approval-policy <policy>  ask | never
  --add-dir <path>            allow an additional writable directory (repeatable)
  -h, --help                  show this help
`;
}
