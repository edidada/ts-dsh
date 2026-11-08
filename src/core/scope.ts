import type { ScopeKey } from './types.js';

/** 生成不透明作用域键；身份即语义，不解析内容。 */
export function newScopeKey(label = 'scope'): ScopeKey {
  return { label };
}

export function scopeLabel(key: ScopeKey | undefined): string {
  if (!key) return 'global';
  const candidate = key as { label?: unknown };
  return typeof candidate.label === 'string' ? candidate.label : key.constructor?.name ?? 'scope';
}

/**
 * 名字解析：最具体者胜（shadowing）。
 * 1) 先用 restrict 对 global 集合做交集过滤（被过滤掉的工具既不在 prompt 也无法执行）；
 * 2) 再用 scoped 注册覆盖同名 global 项。
 */
export function resolveScoped<T>(
  globalItems: Map<string, T>,
  scopedItems: Map<ScopeKey, Map<string, T>>,
  scope: ScopeKey | undefined,
  restrict?: Set<string>,
): Map<string, T> {
  const out = new Map<string, T>();
  for (const [name, item] of globalItems) {
    if (!restrict || restrict.has(name)) out.set(name, item);
  }
  if (scope) {
    const scoped = scopedItems.get(scope);
    if (scoped) {
      for (const [name, item] of scoped) out.set(name, item);
    }
  }
  return out;
}
