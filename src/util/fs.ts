import * as fs from 'node:fs';
import * as path from 'node:path';

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** 判断 target 是否位于 root 之内（含 root 自身），用于工作区写根校验。 */
export function isInside(root: string, target: string): boolean {
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  return resolved === base || resolved.startsWith(base + path.sep);
}

/** 解析路径，越界时抛错；不会经过 shell。 */
export function resolveInside(root: string, target: string): string {
  const resolved = path.resolve(root, target);
  if (!isInside(root, resolved)) {
    throw new Error(`path escapes workspace root: ${target}`);
  }
  return resolved;
}

export function readJsonFile<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function listDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
