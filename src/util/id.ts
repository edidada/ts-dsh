let counter = 0;

/** 进程内单调递增 + 随机后缀，保证同一毫秒内也不碰撞。 */
export function newId(prefix = 'id'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
