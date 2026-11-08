import * as fs from 'node:fs';
import * as path from 'node:path';
import { DshError } from '../core/errors.js';
import { ensureDir } from '../util/fs.js';
import type { SessionEvent, SessionHeader } from './types.js';

export const FORMAT_VERSION = 1;

export function sessionsRoot(home: string): string {
  return path.join(home, 'sessions');
}

export function sessionDir(home: string, id: string): string {
  return path.join(sessionsRoot(home), id);
}

export function generationFile(dir: string, generation: number): string {
  return path.join(dir, `session.v${generation}.jsonl`);
}

/** stat/list 只读 header.json，不加载事件。 */
export function readHeader(dir: string): SessionHeader | null {
  const file = path.join(dir, 'header.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as SessionHeader;
  } catch {
    return null;
  }
}

export function writeHeader(dir: string, header: SessionHeader): void {
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'header.json'), JSON.stringify(header, null, 2) + '\n', 'utf8');
}

/** 选择数值最大的已提交代际；路径永不改名/删除/覆盖。 */
export function latestGeneration(dir: string): number {
  let max = 0;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const match = /^session\.v(\d+)\.jsonl$/.exec(name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

/** 独占发布一个新代际文件（已存在即报错，防止覆盖历史）。 */
export function publishGeneration(dir: string, generation: number, events: SessionEvent[]): void {
  ensureDir(dir);
  const file = generationFile(dir, generation);
  const content = events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : '');
  try {
    fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new DshError('SES_GENERATION_EXISTS', `generation file "${file}" already exists`);
    }
    throw error;
  }
}

export function appendEvents(dir: string, generation: number, events: SessionEvent[]): void {
  ensureDir(dir);
  if (events.length === 0) return;
  const content = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
  fs.appendFileSync(generationFile(dir, generation), content, 'utf8');
}

/**
 * 读取代际文件；容忍「未提交的中断尾行」并就地修复（上游称其为消费者职责）。
 * 中间行损坏则报错，不会静默吞掉数据。
 */
export function readEvents(dir: string, generation: number): SessionEvent[] {
  const file = generationFile(dir, generation);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  const events: SessionEvent[] = [];
  let badTail = false;
  for (let i = 0; i < lines.length; i += 1) {
    try {
      events.push(JSON.parse(lines[i]!) as SessionEvent);
    } catch {
      if (i === lines.length - 1) {
        badTail = true;
        continue;
      }
      throw new DshError('SES_EVENT_CORRUPT', `corrupt event at line ${i + 1} of "${file}"`);
    }
  }
  if (badTail) {
    const repaired = events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : '');
    fs.writeFileSync(file, repaired, 'utf8');
  }
  return events;
}

export function listSessionIds(home: string): string[] {
  try {
    return fs.readdirSync(sessionsRoot(home), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
