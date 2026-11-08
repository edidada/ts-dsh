#!/usr/bin/env node
/**
 * `dsh` 启动器：参数解析 → 组合配置 → 挂载插件 → 运行 app。
 *
 * M3 当前实现到「组合配置 + --dump-config」；M8 会接入 PluginHost 与各 app。
 * 入口始终可构建、可测试，保证每个功能提交都能过 CI。
 */
import { pathToFileURL } from 'node:url';
import { VERSION, NAME } from './version.js';
import { composeConfig, dumpConfig } from './config/compose.js';
import { configSchema } from './config/schema.js';
import { loadHomePatch, loadPatch, resetProfile } from './config/loader.js';
import { BUNDLES, PROFILES, getProfile, profileNames } from './profiles/index.js';
import { DshError, describe } from './core/errors.js';
import { dshHome } from './util/env.js';
import { err, out, redact } from './util/log.js';

const HELP = `${NAME} ${VERSION}
TypeScript 教学级复刻：DeepSeek Harness (dsh) 插件化 Agent 运行时

Usage: dsh [--profile] <name> [options] [app-args...]
       dsh plugin --profile <name> <pnpm-args...>

dsh: boot a profile — an ordered stack of plugin-bundle patch layers
     under your own overrides.

Arguments:
  args                           arguments for the booted profile's app

Options:
  -V, --version                  output the version number
  -h, --help                     show this help
  --profile <name>               the profile under $DSH_HOME/profiles to boot
  --patch <path>                 extra patch overlay applied after the profile
                                 layer (repeatable)
  --dump-config                  print the composed profile tree and exit
  --dump-config-schema           print JSON Schema for profile entries
  --dump-default-config          print the tree without user layer or --patch
  --from-default-profile <name>  recreate a custom profile from a shipped
                                 template

Profiles: ${profileNames().join(', ')}

Examples:
  dsh --profile web --dump-config
  dsh --profile headless "run the tests"
  dsh headless --json "list the files"
`;

export interface LauncherArgs {
  profile: string;
  patchFiles: string[];
  dumpConfig: boolean;
  dumpDefault: boolean;
  dumpSchema: boolean;
  version: boolean;
  help: boolean;
  fromDefault: string | undefined;
  appArgs: string[];
  raw: string[];
}

/** 只解析启动器自身的 flag；其余参数原样交给 app。 */
export function parseLauncher(argv: string[]): LauncherArgs {
  const raw = [...argv];
  let profile = '';
  const patchFiles: string[] = [];
  const appArgs: string[] = [];
  let dumpConfig = false;
  let dumpDefault = false;
  let dumpSchema = false;
  let version = false;
  let help = false;
  let fromDefault: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--') {
      appArgs.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '--profile') { profile = argv[++i] ?? ''; continue; }
    if (arg === '--patch') { patchFiles.push(argv[++i] ?? ''); continue; }
    if (arg === '--from-default-profile') { fromDefault = argv[++i] ?? ''; continue; }
    if (arg === '--dump-config') { dumpConfig = true; continue; }
    if (arg === '--dump-default-config') { dumpDefault = true; continue; }
    if (arg === '--dump-config-schema') { dumpSchema = true; continue; }
    if (arg === '-V' || arg === '--version') { version = true; continue; }
    if (arg === '-h' || arg === '--help') { help = true; continue; }
    if (arg.startsWith('-')) { appArgs.push(arg); continue; }
    if (!profile) { profile = arg; continue; }
    appArgs.push(arg);
  }

  return {
    profile: profile || 'headless',
    patchFiles: patchFiles.filter(Boolean),
    dumpConfig,
    dumpDefault,
    dumpSchema,
    version,
    help,
    fromDefault,
    appArgs,
    raw,
  };
}

export async function run(argv: string[]): Promise<number> {
  const args = parseLauncher(argv);

  if (args.version) { out(VERSION); return 0; }
  if (args.dumpSchema) { out(JSON.stringify(configSchema(), null, 2)); return 0; }
  if (args.help) { out(HELP); return 0; }

  const home = dshHome();

  if (args.fromDefault) {
    const template = PROFILES[args.fromDefault];
    if (!template) {
      throw new DshError(
        'CFG_UNKNOWN_PROFILE',
        `unknown template profile "${args.fromDefault}"`,
        `可用模板：${profileNames().join(', ')}`,
      );
    }
    resetProfile(home, args.profile, template);
    err(`profile "${args.profile}" reset from template "${args.fromDefault}"`);
  }

  const profile = getProfile(args.profile, home);
  const homePatch = loadHomePatch(home, profile.name);
  const cliPatches = args.patchFiles.map(loadPatch);
  const composed = composeConfig({
    profile,
    bundles: BUNDLES,
    homePatch,
    cliPatches,
    defaultOnly: args.dumpDefault,
  });

  if (args.dumpConfig || args.dumpDefault) {
    out(dumpConfig(composed));
    return 0;
  }

  // M8 之前只提示组合结果；应用启动器在 apps 里程碑接入。
  err(`profile "${profile.name}" composed ${composed.rows.length} plugin rows (${composed.layers.length} layers); app runtime wired in M8.`);
  out(HELP);
  return 0;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  run(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((error: unknown) => {
      err(redact(describe(error)));
      process.exitCode = 1;
    });
}
