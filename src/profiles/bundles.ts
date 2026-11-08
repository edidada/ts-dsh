import type { Bundle, ConfigRow } from '../config/types.js';

/**
 * 共享第一层：对齐上游 dsh-base。
 * web / headless / tui / sdk / acp 都先叠加它；sdk-minimal 是刻意例外。
 * 注意「连 agent-loop 自己也是一行配置」——这就是 everything-is-a-plugin。
 */
const baseRows: ConfigRow[] = [
  { id: 'settings', use: 'core/settings' },
  { id: 'credentials', use: 'core/credentials' },
  { id: 'telemetry', use: 'core/telemetry' },
  { id: 'fs', use: 'fs/local' },
  { id: 'sessions', use: 'core/sessions' },
  { id: 'llm', use: 'core/llm' },
  { id: 'llm-deepseek', use: 'llm/deepseek' },
  { id: 'llm-mock', use: 'llm/mock' },
  { id: 'approval', use: 'core/approval' },
  { id: 'tools', use: 'core/tools' },
  { id: 'tools-builtin', use: 'tools/builtin' },
  { id: 'system-prompt', use: 'core/system-prompt' },
  { id: 'agents', use: 'core/agents' },
  { id: 'agent-loop', use: 'core/agent-loop', config: { maxSteps: 8 } },
  { id: 'commands', use: 'core/commands' },
  { id: 'commands-builtin', use: 'commands/builtin' },
];

/** sdk-minimal 自成一树，不叠加 dsh-base（对齐上游的刻意例外）。 */
const minimalRows: ConfigRow[] = [
  { id: 'settings', use: 'core/settings' },
  { id: 'credentials', use: 'core/credentials' },
  { id: 'sessions', use: 'core/sessions' },
  { id: 'llm', use: 'core/llm' },
  { id: 'llm-mock', use: 'llm/mock' },
  { id: 'system-prompt', use: 'core/system-prompt' },
  { id: 'agents', use: 'core/agents' },
  { id: 'agent-loop', use: 'core/agent-loop', config: { maxSteps: 4 } },
  { id: 'commands', use: 'core/commands' },
  { id: 'app', use: 'app/sdk' },
];

export const BUNDLES: Record<string, Bundle> = {
  'dsh-base': { name: 'dsh-base', rows: baseRows },
  'dsh-headless': { name: 'dsh-headless', rows: [{ id: 'app', use: 'app/headless' }] },
  'dsh-tui': { name: 'dsh-tui', rows: [{ id: 'app', use: 'app/tui' }] },
  'dsh-web-app': { name: 'dsh-web-app', rows: [{ id: 'app', use: 'app/web', config: { port: 3080, host: '127.0.0.1' } }] },
  'dsh-sdk-app': { name: 'dsh-sdk-app', rows: [{ id: 'app', use: 'app/sdk' }] },
  'dsh-acp-app': { name: 'dsh-acp-app', rows: [{ id: 'app', use: 'app/acp' }] },
  'dsh-sdk-minimal': { name: 'dsh-sdk-minimal', rows: minimalRows },
};

export function bundleNames(): string[] {
  return Object.keys(BUNDLES).sort();
}
