import { DshError } from '../core/errors.js';
import type { Profile } from '../config/types.js';
import { loadUserProfile } from '../config/loader.js';
import { BUNDLES, bundleNames } from './bundles.js';

/** 内置 profile 模板（对齐上游 web / headless / sdk / sdk-minimal / acp，另加 tui）。 */
export const PROFILES: Record<string, Profile> = {
  web: { name: 'web', bundles: ['dsh-base', 'dsh-web-app'] },
  headless: { name: 'headless', bundles: ['dsh-base', 'dsh-headless'] },
  tui: { name: 'tui', bundles: ['dsh-base', 'dsh-tui'] },
  sdk: { name: 'sdk', bundles: ['dsh-base', 'dsh-sdk-app'] },
  'sdk-minimal': { name: 'sdk-minimal', bundles: ['dsh-sdk-minimal'] },
  acp: { name: 'acp', bundles: ['dsh-base', 'dsh-acp-app'] },
};

export function profileNames(): string[] {
  return Object.keys(PROFILES).sort();
}

export function isBuiltinProfile(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROFILES, name);
}

/** 优先用 $DSH_HOME 里的用户 profile，否则回退到内置模板。 */
export function getProfile(name: string, home: string): Profile {
  const user = loadUserProfile(home, name);
  if (user) return user;
  if (isBuiltinProfile(name)) return PROFILES[name]!;
  throw new DshError(
    'CFG_UNKNOWN_PROFILE',
    `unknown profile "${name}"`,
    `内置 profile：${profileNames().join(', ')}；或先用 --from-default-profile <模板> 创建自定义 profile。`,
  );
}

export { BUNDLES, bundleNames };
