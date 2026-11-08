import { DshError } from '../core/errors.js';
import { envStr } from '../util/env.js';
import type { ModelAdapter } from './types.js';

export interface ResolveOptions {
  /** 显式指定适配器 id，优先于环境变量 */
  requested?: string;
  /** 显式传入 API Key；不传则读 DEEPSEEK_API_KEY */
  apiKey?: string;
}

/** ctx.llm：模型适配器注册表（能力接缝的 Service Definition）。 */
export class LlmRegistry {
  private readonly adapters = new Map<string, ModelAdapter>();

  register(adapter: ModelAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  has(id: string): boolean {
    return this.adapters.has(id);
  }

  get(id: string): ModelAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new DshError('LLM_UNKNOWN_ADAPTER', `model adapter "${id}" is not registered`);
    }
    return adapter;
  }

  list(): string[] {
    return [...this.adapters.keys()].sort();
  }

  /**
   * 有 Key 用 DeepSeek；无 Key 自动回退 Mock（CI 离线可跑）。
   * DSH_MODEL_ADAPTER 或 --adapter 可强制指定。
   */
  resolve(options: ResolveOptions = {}): ModelAdapter {
    const forced = options.requested ?? envStr('DSH_MODEL_ADAPTER');
    if (forced) {
      if (!this.has(forced)) {
        throw new DshError(
          'LLM_UNKNOWN_ADAPTER',
          `requested model adapter "${forced}" is not registered`,
          `已注册适配器：${this.list().join(', ')}`,
        );
      }
      return this.get(forced);
    }
    const key = options.apiKey ?? envStr('DEEPSEEK_API_KEY');
    if (key && this.has('deepseek')) return this.get('deepseek');
    if (this.has('mock')) return this.get('mock');
    throw new DshError(
      'LLM_NO_ADAPTER',
      'no usable model adapter registered',
      '至少注册 llm/mock 插件，或设置 DEEPSEEK_API_KEY。',
    );
  }
}
