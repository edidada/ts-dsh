import * as os from 'node:os';
import * as path from 'node:path';

/** $DSH_HOME，默认 ~/.dsh。会话、profile、配置都落在这里。 */
export function dshHome(): string {
  const override = process.env.DSH_HOME;
  return override && override.length > 0 ? path.resolve(override) : path.join(os.homedir(), '.dsh');
}

export function envStr(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function envBool(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true' || raw === 'yes';
}
