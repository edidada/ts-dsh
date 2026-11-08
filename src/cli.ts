#!/usr/bin/env node
/**
 * `dsh` 启动器。
 *
 * 本文件在 M1 只提供最小可运行骨架（--version / --help），
 * 后续里程碑会替换为「参数解析 → 组合配置 → 挂载插件 → 运行 app」的完整实现。
 * 保持入口始终可构建、可测试，是每个功能提交都能过 CI 的前提。
 */
import { VERSION, NAME } from './version.js';

const HELP = `${NAME} ${VERSION}
TypeScript 教学级复刻：DeepSeek Harness (dsh) 插件化 Agent 运行时

Usage: dsh [--profile] <name> [options] [app-args...]
       dsh plugin --profile <name> <pnpm-args...>

Options:
  -V, --version                  output the version number
  -h, --help                     show this help
  --profile <name>               the profile to boot
  --patch <path>                 extra patch overlay (repeatable)
  --dump-config                  print the composed plugin tree and exit
  --dump-config-schema           print JSON Schema for profile entries
  --dump-default-config          print the profile tree without user layers
  --from-default-profile <name>  recreate a profile from a shipped template

Examples:
  dsh --profile web --dump-config
  dsh --profile headless "run the tests"
`;

export function run(argv: string[]): number {
  if (argv.includes('--version') || argv.includes('-V')) {
    process.stdout.write(VERSION + '\n');
    return 0;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  process.stdout.write(HELP);
  return 0;
}

process.exitCode = run(process.argv.slice(2));
