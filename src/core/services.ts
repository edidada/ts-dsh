import { envStr } from '../util/env.js';
import { resolveInside } from '../util/fs.js';

/** ctx.settings：轻量键值设置（命令行 /model 等会写这里）。 */
export class Settings {
  private readonly values = new Map<string, unknown>();

  constructor(initial: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
  }

  get<T>(key: string, fallback: T): T {
    const value = this.values.get(key);
    return value === undefined ? fallback : (value as T);
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  all(): Record<string, unknown> {
    return Object.fromEntries(this.values);
  }
}

/** ctx.credentials：只暴露脱敏信息，密钥不进日志、不落盘。 */
export class Credentials {
  apiKey(): string {
    return envStr('DEEPSEEK_API_KEY');
  }

  masked(): string {
    const key = this.apiKey();
    return key ? `${key.slice(0, 4)}***` : '(none)';
  }
}

/** ctx.telemetry：进程内计数器（上游遥测 seam 的最小实现）。 */
export class Telemetry {
  private readonly counters = new Map<string, number>();

  inc(key: string, amount = 1): void {
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }
}

/** ctx.fs：文件系统能力接缝（简化版）。 */
export interface FsService {
  cwd: string;
  home: string;
  resolve(target: string): string;
}

export function localFs(cwd: string, home: string): FsService {
  return { cwd, home, resolve: (target: string) => resolveInside(cwd, target) };
}
