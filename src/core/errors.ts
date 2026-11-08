/**
 * 统一错误模型。错误码按域划分，CLI 会打印 `code: message` 与面向新手的 hint。
 * CFG_ 配置 / PLG_ 插件 / SES_ 会话 / LLM_ 模型 / TOL_ 工具 / APP_ 应用
 */
export class DshError extends Error {
  readonly code: string;
  readonly hint: string | undefined;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = 'DshError';
    this.code = code;
    this.hint = hint;
  }
}

export function fail(code: string, message: string, hint?: string): never {
  throw new DshError(code, message, hint);
}

export function describe(err: unknown): string {
  if (err instanceof DshError) {
    return err.hint ? `${err.code}: ${err.message}\n  hint: ${err.hint}` : `${err.code}: ${err.message}`;
  }
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
