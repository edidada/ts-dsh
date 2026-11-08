import { err } from '../util/log.js';
import type { App } from './runtime.js';

/** 自动化运行形态占位：与上游 acp profile 对齐，本复刻不实现 ACP 协议细节。 */
export function createAcpApp(): App {
  return {
    id: 'acp',
    async run(): Promise<number> {
      err('acp profile: automation-only ACP server placeholder (protocol not implemented in this teaching clone).');
      return 0;
    },
  };
}
