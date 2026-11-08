/** stdout 只放结果；诊断信息一律走 stderr，便于 --json 被管道消费。 */
export function out(line = ''): void {
  process.stdout.write(line + '\n');
}

export function err(line = ''): void {
  process.stderr.write(line + '\n');
}

/** 日志脱敏：避免 API Key 出现在 CI 日志里。 */
export function redact(text: string): string {
  return text.replace(/(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]{4,}/g, '$1***');
}
