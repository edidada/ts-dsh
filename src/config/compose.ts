import { DshError } from '../core/errors.js';
import type { Bundle, ComposeInput, ComposeResult, ConfigRow, Patch, PatchOp } from './types.js';

function cloneRow(row: ConfigRow, layer: string): ConfigRow {
  return { ...row, layer };
}

function indexOfId(rows: ConfigRow[], id: string): number {
  return rows.findIndex((row) => row.id === id);
}

function upsert(rows: ConfigRow[], row: ConfigRow): void {
  const index = indexOfId(rows, row.id);
  if (index >= 0) rows[index] = row;
  else rows.push(row);
}

function applyOp(rows: ConfigRow[], op: PatchOp, layer: string): void {
  switch (op.op) {
    case 'replace': {
      // 整体替换，不深合并：上层可完全接管下层配置
      const row = cloneRow(op.row, layer);
      const index = indexOfId(rows, op.id);
      if (index >= 0) rows[index] = row;
      else rows.push(row);
      return;
    }
    case 'insert': {
      const existing = indexOfId(rows, op.row.id);
      if (existing >= 0) rows.splice(existing, 1);
      const row = cloneRow(op.row, layer);
      let at = -1;
      if (op.before) at = indexOfId(rows, op.before);
      if (at < 0 && op.after) {
        const after = indexOfId(rows, op.after);
        at = after >= 0 ? after + 1 : -1;
      }
      if (at >= 0) rows.splice(at, 0, row);
      else rows.push(row);
      return;
    }
    case 'remove': {
      const index = indexOfId(rows, op.id);
      if (index >= 0) rows.splice(index, 1);
      return;
    }
    default:
      throw new DshError('CFG_PATCH_INVALID', `unknown patch operation: ${JSON.stringify(op)}`);
  }
}

function applyPatch(rows: ConfigRow[], patch: Patch, layer: string): void {
  for (const op of patch.ops) applyOp(rows, op, layer);
}

function validate(rows: ConfigRow[], knownUses?: Set<string>): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.id || typeof row.id !== 'string') {
      throw new DshError('CFG_ROW_INVALID', `every config row needs a string id: ${JSON.stringify(row)}`);
    }
    if (seen.has(row.id)) {
      throw new DshError('CFG_DUPLICATE_ID', `duplicate config row id "${row.id}"`);
    }
    seen.add(row.id);
    if (!row.use || typeof row.use !== 'string') {
      throw new DshError('CFG_ROW_INVALID', `config row "${row.id}" needs a string use`);
    }
    if (knownUses && !knownUses.has(row.use)) {
      throw new DshError(
        'CFG_UNKNOWN_USE',
        `config row "${row.id}" references unknown plugin "${row.use}"`,
        `可用 use 值：${[...knownUses].sort().join(', ')}`,
      );
    }
  }
}

/**
 * 分层组合：bundles → profile patch → home patch → --patch（后者优先）。
 * 结果就是一次运行要挂载的完整插件树。
 */
export function composeConfig(input: ComposeInput): ComposeResult {
  const { profile, bundles, defaultOnly = false } = input;
  const rows: ConfigRow[] = [];
  const layers: string[] = [];

  for (const bundleName of profile.bundles) {
    const bundle: Bundle | undefined = bundles[bundleName];
    if (!bundle) {
      throw new DshError(
        'CFG_UNKNOWN_BUNDLE',
        `profile "${profile.name}" references unknown bundle "${bundleName}"`,
        `可用 bundle：${Object.keys(bundles).sort().join(', ')}`,
      );
    }
    layers.push(`bundle:${bundleName}`);
    for (const row of bundle.rows) upsert(rows, cloneRow(row, `bundle:${bundleName}`));
  }

  if (profile.patch) {
    layers.push(`profile:${profile.name}`);
    applyPatch(rows, profile.patch, `profile:${profile.name}`);
  }

  if (!defaultOnly) {
    if (input.homePatch) {
      layers.push('home');
      applyPatch(rows, input.homePatch, 'home');
    }
    for (const patch of input.cliPatches ?? []) {
      layers.push(`patch:${patch.name}`);
      applyPatch(rows, patch, `patch:${patch.name}`);
    }
  }

  for (const plugin of profile.plugins ?? []) {
    upsert(rows, cloneRow({ id: `plugin:${plugin}`, use: plugin }, `profile:${profile.name}`));
  }

  const enabled = rows.filter((row) => row.enabled !== false);
  validate(enabled, input.knownUses);
  return { profile: profile.name, layers, rows: enabled };
}

/** --dump-config / --dump-default-config 的输出。 */
export function dumpConfig(result: ComposeResult): string {
  return JSON.stringify(result, null, 2);
}
