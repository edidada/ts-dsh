import { Context } from './context.js';
import { DshError } from './errors.js';
import type { Disposable, DisposeFn } from './types.js';

export interface PluginRow {
  id: string;
  use: string;
  config?: Record<string, unknown>;
}

export type PluginFactory = (
  ctx: Context,
  config: Record<string, unknown>,
) => void | Disposable | Promise<void | Disposable>;

export interface MountedPlugin {
  id: string;
  use: string;
  effects: DisposeFn[];
}

/**
 * 把 ConfigRow[] 逐行挂载成服务。
 * 每行产生的所有副作用被捕获到该行名下：unmount(id) 逆序回滚，
 * 实现「移除插件即移除它注册的一切，不残留」。
 */
export class PluginHost {
  private readonly mounted = new Map<string, MountedPlugin>();

  constructor(
    private readonly ctx: Context,
    private readonly factories: Map<string, PluginFactory>,
  ) {}

  async boot(rows: PluginRow[]): Promise<void> {
    for (const row of rows) await this.mount(row);
  }

  async mount(row: PluginRow): Promise<void> {
    const factory = this.factories.get(row.use);
    if (!factory) {
      throw new DshError(
        'PLG_UNKNOWN_FACTORY',
        `no plugin factory registered for "${row.use}"`,
        `可用 use 值见 --dump-config；自定义插件需先在 profiles/index.ts 的 FACTORIES 中登记。`,
      );
    }
    if (this.mounted.has(row.id)) {
      throw new DshError('PLG_DUPLICATE_ID', `plugin row id "${row.id}" is already mounted`);
    }

    this.ctx.beginCapture();
    let result: void | Disposable;
    try {
      result = await factory(this.ctx, row.config ?? {});
    } catch (err) {
      // 挂载失败也要回滚本次已产生的副作用
      const partial = this.ctx.endCapture();
      for (const fn of partial.slice().reverse()) {
        try { fn(); } catch { /* ignore */ }
      }
      this.ctx.release(partial);
      throw err;
    }
    const effects = this.ctx.endCapture();

    if (result && typeof result === 'object' && typeof (result as Disposable).dispose === 'function') {
      const disposable = result as Disposable;
      const fn: DisposeFn = () => disposable.dispose();
      effects.push(fn);
      this.ctx.onDispose(fn);
    }
    this.mounted.set(row.id, { id: row.id, use: row.use, effects });
  }

  unmount(id: string): void {
    const mounted = this.mounted.get(id);
    if (!mounted) return;
    for (const fn of mounted.effects.slice().reverse()) {
      try { fn(); } catch { /* ignore */ }
    }
    this.ctx.release(mounted.effects);
    this.mounted.delete(id);
  }

  list(): Array<{ id: string; use: string }> {
    return [...this.mounted.values()].map(({ id, use }) => ({ id, use }));
  }

  has(id: string): boolean {
    return this.mounted.has(id);
  }

  dispose(): void {
    for (const id of [...this.mounted.keys()].reverse()) this.unmount(id);
  }
}
