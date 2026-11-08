import type { Disposable } from './types.js';

/** serial 监听者：依次执行，无需（也不应）调用 next。 */
export type SerialHandler<T> = (payload: T) => void | Promise<void>;
/** waterfall 监听者：必须调用 next() 才会把控制权交给下一个监听者。 */
export type WaterfallHandler<T> = (payload: T, next: () => Promise<void>) => void | Promise<void>;

/**
 * 极简事件总线。
 * - on() 注册 waterfall 监听者（不调用 next() 即截断链路）
 * - onSerial() 注册 serial 监听者（自动委托，保证全部执行）
 * - emit() 按注册顺序分发，返回被监听者改写后的同一个 payload 对象
 */
export class EventBus {
  private readonly listeners = new Map<string, Array<(payload: unknown, next: () => Promise<void>) => void | Promise<void>>>();

  on<T>(name: string, handler: WaterfallHandler<T>): Disposable {
    const list = this.listeners.get(name) ?? [];
    const wrapped = handler as unknown as (payload: unknown, next: () => Promise<void>) => void | Promise<void>;
    list.push(wrapped);
    this.listeners.set(name, list);
    let active = true;
    return {
      dispose: () => {
        if (!active) return;
        active = false;
        const i = list.indexOf(wrapped);
        if (i >= 0) list.splice(i, 1);
      },
    };
  }

  onSerial<T>(name: string, handler: SerialHandler<T>): Disposable {
    return this.on<T>(name, async (payload, next) => {
      await handler(payload);
      await next();
    });
  }

  async emit<T>(name: string, payload: T): Promise<T> {
    const list = [...(this.listeners.get(name) ?? [])];
    let index = 0;
    const next = async (): Promise<void> => {
      const handler = list[index++];
      if (!handler) return;
      await handler(payload as unknown, next);
    };
    await next();
    return payload;
  }

  listenerCount(name: string): number {
    return this.listeners.get(name)?.length ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
