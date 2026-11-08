import * as path from 'node:path';
import { DshError } from '../core/errors.js';
import { ensureDir } from '../util/fs.js';
import { newId } from '../util/id.js';
import {
  FORMAT_VERSION,
  appendEvents,
  latestGeneration,
  listSessionIds,
  publishGeneration,
  readEvents,
  readHeader,
  sessionDir,
  sessionsRoot,
  writeHeader,
} from './jsonl.js';
import { deriveMessages, lastAssistantText, missingToolResults } from './projection.js';
import type { EventInput, HistoryMessage, SessionEvent, SessionHeader } from './types.js';

export interface SessionState {
  header: SessionHeader;
  events: SessionEvent[];
  openTurn: string | null;
  currentStep: number;
  generation: number;
  dir: string;
}

export interface ReplayResult {
  sessionId: string;
  eventCount: number;
  openTurn: string | null;
  currentStep: number;
  generation: number;
}

/**
 * append-only 会话存储：内存索引 + JSONL 物理帧。
 * create/open/append/replay/fork/resume/search/stat/list 全部从日志派生。
 */
export class SessionStore {
  private readonly home: string;
  private readonly cache = new Map<string, SessionState>();

  constructor(home: string) {
    this.home = home;
    ensureDir(sessionsRoot(home));
  }

  create(title?: string): SessionState {
    const id = newId('session');
    const dir = sessionDir(this.home, id);
    ensureDir(dir);
    const now = Date.now();
    const header: SessionHeader = {
      id,
      createdAt: now,
      updatedAt: now,
      generation: 1,
      format: FORMAT_VERSION,
      eventCount: 0,
      ...(title ? { title } : {}),
    };
    publishGeneration(dir, 1, []);
    writeHeader(dir, header);
    this.cache.set(id, {
      header,
      events: [],
      openTurn: null,
      currentStep: 0,
      generation: 1,
      dir,
    });
    this.append(id, { type: 'session/created', ...(title ? { title } : {}) });
    return this.cache.get(id)!;
  }

  open(id: string): SessionState {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const dir = sessionDir(this.home, id);
    const stored = readHeader(dir);
    if (!stored) {
      throw new DshError(
        'SES_SESSION_NOT_FOUND',
        `session "${id}" not found`,
        '用 --session-id 续跑前，先确认该会话存在；可用 session list 查看。',
      );
    }
    if ((stored.format ?? 1) > FORMAT_VERSION) {
      throw new DshError(
        'SES_FUTURE_VERSION',
        `session "${id}" uses format ${stored.format}, this build only supports ${FORMAT_VERSION}`,
      );
    }
    const generation = latestGeneration(dir);
    const events = readEvents(dir, generation);
    const state: SessionState = {
      header: { ...stored, generation, eventCount: events.length },
      events,
      openTurn: null,
      currentStep: 0,
      generation,
      dir,
    };
    this.applyReplay(state);
    this.cache.set(id, state);
    return state;
  }

  append(id: string, input: EventInput): SessionEvent {
    const state = this.open(id);
    const event = {
      ...input,
      sessionId: id,
      seq: state.events.length + 1,
      ts: Date.now(),
    } as unknown as SessionEvent;

    state.events.push(event);
    state.header.eventCount = state.events.length;
    state.header.updatedAt = event.ts;

    if (event.type === 'turn/start') state.openTurn = event.turnId;
    else if (event.type === 'turn/end') state.openTurn = null;
    else if (event.type === 'step/start') state.currentStep = event.step;

    appendEvents(state.dir, state.generation, [event]);
    writeHeader(state.dir, state.header);
    return event;
  }

  events(id: string): SessionEvent[] {
    return this.open(id).events.slice();
  }

  header(id: string): SessionHeader {
    return { ...this.open(id).header };
  }

  deriveMessages(id: string): HistoryMessage[] {
    return deriveMessages(this.open(id).events);
  }

  lastAssistantText(id: string): string {
    return lastAssistantText(this.open(id).events);
  }

  missingToolResults(id: string): Array<{ callId: string; name: string }> {
    return missingToolResults(this.open(id).events);
  }

  replay(id: string): ReplayResult {
    const state = this.open(id);
    this.applyReplay(state);
    return {
      sessionId: id,
      eventCount: state.events.length,
      openTurn: state.openTurn,
      currentStep: state.currentStep,
      generation: state.generation,
    };
  }

  /** 全文检索（大小写不敏感）；返回匹配的 durable 事件。 */
  search(id: string, query: string): SessionEvent[] {
    const needle = query.toLowerCase();
    if (!needle) return [];
    return this.open(id).events.filter((event) => JSON.stringify(event).toLowerCase().includes(needle));
  }

  /** 只读 header，不加载事件。 */
  stat(id: string): SessionHeader | null {
    return readHeader(sessionDir(this.home, id));
  }

  list(): SessionHeader[] {
    return listSessionIds(this.home)
      .map((id) => this.stat(id))
      .filter((header): header is SessionHeader => header !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 分叉：新会话、新代际文件，源文件永不改写。 */
  fork(sourceId: string, atSeq?: number): SessionState {
    const source = this.open(sourceId);
    let cut = atSeq ?? source.events.length;
    if (atSeq === undefined && source.openTurn) {
      // 默认在最后一个已闭合的 turn 边界分叉
      for (let i = source.events.length - 1; i >= 0; i -= 1) {
        if (source.events[i]!.type === 'turn/end') {
          cut = i + 1;
          break;
        }
      }
    }
    cut = Math.max(0, Math.min(cut, source.events.length));

    const id = newId('session');
    const dir = sessionDir(this.home, id);
    ensureDir(dir);
    const copied = source.events
      .slice(0, cut)
      .map((event, index) => ({ ...event, sessionId: id, seq: index + 1 }) as unknown as SessionEvent);
    publishGeneration(dir, 1, copied);

    const now = Date.now();
    const header: SessionHeader = {
      id,
      createdAt: now,
      updatedAt: now,
      generation: 1,
      format: FORMAT_VERSION,
      eventCount: copied.length,
      forkedFrom: sourceId,
      forkAtSeq: cut,
    };
    writeHeader(dir, header);
    const state: SessionState = {
      header,
      events: copied,
      openTurn: null,
      currentStep: 0,
      generation: 1,
      dir,
    };
    this.applyReplay(state);
    this.cache.set(id, state);
    return state;
  }

  /** 续跑：发布一个新的代际文件，旧代际保持不变。 */
  resume(id: string): SessionState {
    const state = this.open(id);
    const generation = latestGeneration(state.dir) + 1;
    publishGeneration(state.dir, generation, state.events);
    state.generation = generation;
    state.header.generation = generation;
    state.header.updatedAt = Date.now();
    writeHeader(state.dir, state.header);
    return state;
  }

  close(id: string): void {
    this.cache.delete(id);
  }

  private applyReplay(state: SessionState): void {
    let openTurn: string | null = null;
    let currentStep = 0;
    for (const event of state.events) {
      if (event.type === 'turn/start') openTurn = event.turnId;
      else if (event.type === 'turn/end') openTurn = null;
      else if (event.type === 'step/start') currentStep = event.step;
    }
    state.openTurn = openTurn;
    state.currentStep = currentStep;
  }
}

export function sessionsHome(home: string): string {
  return path.join(home, 'sessions');
}
