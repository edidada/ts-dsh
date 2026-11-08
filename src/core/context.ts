import { EventBus } from './events.js';
import { DshError } from './errors.js';
import type { Disposable, DisposeFn, ScopeKey } from './types.js';

interface ServiceEntry {
  value: unknown;
}

type ServiceListener = (kind: 'added' | 'removed', value: unknown) => void;

interface SharedState {
  services: Map<string, ServiceEntry>;
  effects: DisposeFn[];
  events: EventBus;
  waiting: Map<string, Array<(value: unknown) => void>>;
  serviceListeners: Map<string, Set<ServiceListener>>;
  capture: DisposeFn[] | null;
  disposed: boolean;
}

/**
 * 插件宿主。
 *
 * - 服务通过 provide() 挂到 ctx.<key>，消费方只依赖 key，不 import 实现（能力接缝）。
 * - 所有注册都是可逆副作用；dispose() 逆序回滚（时间可组合性）。
 * - waitFor / onService 让组件声明依赖，服务出现时得到通知（空间可组合性的最小实现）。
 * - scoped() 派生共享同一份注册表的子上下文，仅携带不同的 scope key。
 */
export class Context {
  readonly events: EventBus;
  readonly scope: ScopeKey | undefined;
  private readonly state: SharedState;

  constructor(scope?: ScopeKey, shared?: SharedState) {
    this.scope = scope;
    this.state = shared ?? {
      services: new Map(),
      effects: [],
      events: new EventBus(),
      waiting: new Map(),
      serviceListeners: new Map(),
      capture: null,
      disposed: false,
    };
    this.events = this.state.events;
  }

  scoped(scopeKey: ScopeKey): Context {
    return new Context(scopeKey, this.state);
  }

  private assertAlive(): void {
    if (this.state.disposed) {
      throw new DshError('PLG_CONTEXT_DISPOSED', 'context has been disposed');
    }
  }

  /** 注册服务，返回可逆句柄（调用 dispose 即撤销注册）。 */
  provide<T>(key: string, value: T): Disposable {
    this.assertAlive();
    this.state.services.set(key, { value });
    this.notify(key, 'added', value);
    this.resolveWaiters(key, value);

    let done = false;
    const undo: DisposeFn = () => {
      if (done) return;
      done = true;
      const current = this.state.services.get(key);
      if (current && current.value === value) {
        this.state.services.delete(key);
        this.notify(key, 'removed', value);
      }
    };
    return this.onDispose(undo);
  }

  get<T>(key: string): T {
    this.assertAlive();
    const entry = this.state.services.get(key);
    if (!entry) {
      throw new DshError(
        'PLG_SERVICE_MISSING',
        `service "${key}" is not registered`,
        `确认提供 ctx.${key} 的插件在配置树中排在使用方之前（可用 --dump-config 查看顺序）。`,
      );
    }
    return entry.value as T;
  }

  peek<T>(key: string): T | undefined {
    if (this.state.disposed) return undefined;
    const entry = this.state.services.get(key);
    return entry ? (entry.value as T) : undefined;
  }

  has(key: string): boolean {
    return this.state.services.has(key);
  }

  serviceKeys(): string[] {
    return [...this.state.services.keys()];
  }

  /** 等某个服务就绪；已就绪则立即 resolve。 */
  waitFor<T>(key: string): Promise<T> {
    const entry = this.state.services.get(key);
    if (entry) return Promise.resolve(entry.value as T);
    return new Promise<T>((resolve) => {
      const list = this.state.waiting.get(key) ?? [];
      list.push((value) => resolve(value as T));
      this.state.waiting.set(key, list);
    });
  }

  onService(key: string, listener: ServiceListener): Disposable {
    const set = this.state.serviceListeners.get(key) ?? new Set<ServiceListener>();
    set.add(listener);
    this.state.serviceListeners.set(key, set);
    return this.onDispose(() => set.delete(listener));
  }

  /** 登记可逆副作用。返回的句柄可提前撤销一次副作用。 */
  onDispose(fn: DisposeFn): Disposable {
    this.state.effects.push(fn);
    if (this.state.capture) this.state.capture.push(fn);

    let done = false;
    return {
      dispose: () => {
        if (done) return;
        done = true;
        this.release([fn]);
        fn();
      },
    };
  }

  /** PluginHost 收集某次 mount 产生的副作用时使用。 */
  beginCapture(): void {
    this.state.capture = [];
  }

  endCapture(): DisposeFn[] {
    const captured = this.state.capture ?? [];
    this.state.capture = null;
    return captured;
  }

  /** 把已由外部执行过的副作用从全局列表中移除，避免重复回滚。 */
  release(fns: DisposeFn[]): void {
    for (const fn of fns) {
      const i = this.state.effects.indexOf(fn);
      if (i >= 0) this.state.effects.splice(i, 1);
      if (this.state.capture) {
        const j = this.state.capture.indexOf(fn);
        if (j >= 0) this.state.capture.splice(j, 1);
      }
    }
  }

  dispose(): void {
    if (this.state.disposed) return;
    this.state.disposed = true;
    const effects = this.state.effects.slice().reverse();
    this.state.effects = [];
    for (const fn of effects) {
      try {
        fn();
      } catch {
        // 回滚期间的错误不阻断其余清理
      }
    }
    this.state.services.clear();
    this.state.waiting.clear();
    this.state.serviceListeners.clear();
    this.events.clear();
  }

  private notify(key: string, kind: 'added' | 'removed', value: unknown): void {
    const set = this.state.serviceListeners.get(key);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(kind, value);
      } catch {
        // 监听者异常不影响服务注册本身
      }
    }
  }

  private resolveWaiters(key: string, value: unknown): void {
    const list = this.state.waiting.get(key);
    if (!list) return;
    this.state.waiting.delete(key);
    for (const resolve of list) resolve(value);
  }
}
