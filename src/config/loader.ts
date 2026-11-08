import * as fs from 'node:fs';
import * as path from 'node:path';
import { DshError } from '../core/errors.js';
import type { Patch, PatchOp, Profile } from './types.js';
import { writeJsonFile } from '../util/fs.js';

export function profilesDir(home: string): string {
  return path.join(home, 'profiles');
}

export function profileFile(home: string, name: string): string {
  return path.join(profilesDir(home), name, 'profile.json');
}

export function homePatchFile(home: string, name: string): string {
  return path.join(profilesDir(home), name, 'cordis.patch.json');
}

/** 读取一个 patch 文件；允许 { name, ops } 或直接是 PatchOp[]。 */
export function loadPatch(file: string): Patch {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    throw new DshError('CFG_PATCH_NOT_FOUND', `cannot read patch file "${file}"`, '确认路径存在，或用 --patch 传入绝对路径。');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DshError('CFG_PATCH_INVALID', `patch file "${file}" is not valid JSON`, '本复刻用 JSON patch 代替上游的 YAML patch。');
  }
  if (Array.isArray(parsed)) {
    return { name: path.basename(file), ops: parsed as PatchOp[] };
  }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Patch).ops)) {
    const patch = parsed as Patch;
    return { name: patch.name || path.basename(file), ops: patch.ops };
  }
  throw new DshError('CFG_PATCH_INVALID', `patch file "${file}" must be a PatchOp[] or { name, ops }`);
}

/** home 层 patch 不存在时返回 null（不是错误）。 */
export function loadHomePatch(home: string, profileName: string): Patch | null {
  const file = homePatchFile(home, profileName);
  if (!fs.existsSync(file)) return null;
  return loadPatch(file);
}

export function loadUserProfile(home: string, name: string): Profile | null {
  const file = profileFile(home, name);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Profile;
    if (!parsed || !Array.isArray(parsed.bundles)) return null;
    return { ...parsed, name };
  } catch {
    throw new DshError('CFG_PROFILE_INVALID', `profile file "${file}" is not valid JSON`);
  }
}

export function saveUserProfile(home: string, profile: Profile): void {
  writeJsonFile(profileFile(home, profile.name), profile);
}

/** --from-default-profile <template>：用内置模板重建自定义 profile。 */
export function resetProfile(home: string, name: string, template: Profile): Profile {
  const fresh: Profile = {
    name,
    bundles: [...template.bundles],
    ...(template.patch ? { patch: JSON.parse(JSON.stringify(template.patch)) as Patch } : {}),
    ...(template.plugins ? { plugins: [...template.plugins] } : {}),
  };
  saveUserProfile(home, fresh);
  return fresh;
}
