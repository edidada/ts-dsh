import type { JsonObject } from '../core/types.js';

/** 插件树中的一行：一个待挂载的插件及其配置。 */
export interface ConfigRow {
  id: string;
  use: string;
  config?: JsonObject;
  enabled?: boolean;
  /** 溯源标记（组合时写入，不参与 patch 匹配）。 */
  layer?: string;
}

export type PatchOp =
  | { op: 'replace'; id: string; row: ConfigRow }
  | { op: 'insert'; row: ConfigRow; before?: string; after?: string }
  | { op: 'remove'; id: string };

/** 一层覆盖：按 id 整体替换 / 插入 / 删除，不做深合并。 */
export interface Patch {
  name: string;
  ops: PatchOp[];
}

/** Bundle 是分发格式：一批 ConfigRow 及其代码。 */
export interface Bundle {
  name: string;
  rows: ConfigRow[];
}

/** Profile 是命名组合：有序 bundle 列表 + 自己的 patch + 外挂插件。 */
export interface Profile {
  name: string;
  bundles: string[];
  patch?: Patch;
  plugins?: string[];
}

export interface ComposeInput {
  profile: Profile;
  bundles: Record<string, Bundle>;
  homePatch?: Patch | null;
  cliPatches?: Patch[];
  /** true = 跳过用户层与 --patch，用于 --dump-default-config */
  defaultOnly?: boolean;
  /** 若提供，则校验每个 use 都在工厂表中 */
  knownUses?: Set<string>;
}

export interface ComposeResult {
  profile: string;
  layers: string[];
  rows: ConfigRow[];
}
