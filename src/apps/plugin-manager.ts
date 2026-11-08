import { describe } from '../core/errors.js';
import type { Profile } from '../config/types.js';
import { loadUserProfile, saveUserProfile } from '../config/loader.js';
import { getProfile, profileNames } from '../profiles/index.js';
import { err, out } from '../util/log.js';

export interface PluginManagerArgs {
  profile: string;
  appArgs: string[];
}

const USAGE = `Usage: dsh plugin --profile <name> <add|remove|list|why> [args...]

管理某个 profile 的外挂插件列表（写入 $DSH_HOME/profiles/<name>/profile.json）。
内置 profile：${profileNames().join(', ')}
`;

/** dsh plugin 子命令：把剩余参数解释为插件管理动作。 */
export function runPluginManager(args: PluginManagerArgs, home: string): number {
  const [sub, ...rest] = args.appArgs;
  if (!sub) {
    out(USAGE);
    return 1;
  }

  let template: Profile;
  try {
    template = getProfile(args.profile, home);
  } catch (error) {
    err(describe(error));
    return 1;
  }

  const editable: Profile = loadUserProfile(home, args.profile) ?? {
    name: args.profile,
    bundles: [...template.bundles],
    plugins: [],
  };
  const plugins = editable.plugins ?? [];

  switch (sub) {
    case 'list':
      out(plugins.length ? plugins.join('\n') : `(no extra plugins in profile "${args.profile}")`);
      return 0;
    case 'add': {
      const name = rest[0];
      if (!name) { err('需要插件包名，例如：dsh plugin --profile tui add my-plugin'); return 1; }
      if (!plugins.includes(name)) plugins.push(name);
      editable.plugins = plugins;
      saveUserProfile(home, editable);
      out(`added ${name} -> profile ${args.profile}`);
      return 0;
    }
    case 'remove': {
      const name = rest[0];
      if (!name) { err('需要插件包名'); return 1; }
      editable.plugins = plugins.filter((item) => item !== name);
      saveUserProfile(home, editable);
      out(`removed ${name} -> profile ${args.profile}`);
      return 0;
    }
    case 'why': {
      const name = rest[0] ?? '';
      out(plugins.includes(name)
        ? `${name} 由 profile ${args.profile} 的 plugins 列表安装`
        : `${name} 未在 profile ${args.profile} 中显式安装（可能由 bundle 提供）`);
      return 0;
    }
    default:
      err(`未知子命令 "${sub}"`);
      out(USAGE);
      return 1;
  }
}
