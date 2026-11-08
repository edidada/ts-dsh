/** 所有注册（服务、事件监听、工具、命令）都是可逆副作用。 */
export interface Disposable {
  dispose(): void;
}

export type DisposeFn = () => void;

/** 作用域键：不透明对象，按对象身份比较（对齐上游 scope key 约定）。 */
export type ScopeKey = object;

export type JsonObject = Record<string, unknown>;
