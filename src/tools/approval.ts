import * as path from 'node:path';
import { isInside } from '../util/fs.js';
import type { Tool, ToolRisk } from './types.js';

export type PermissionMode = 'read-only' | 'workspace-write' | 'full-access';
export type ApprovalBehavior = 'ask' | 'never';

const MODE_RISKS: Record<PermissionMode, ToolRisk[]> = {
  'read-only': ['read'],
  'workspace-write': ['read', 'write'],
  'full-access': ['read', 'write', 'exec'],
};

export interface ApprovalOptions {
  mode?: PermissionMode;
  behavior?: ApprovalBehavior;
  cwd?: string;
  writeRoots?: string[];
  /** 预批准的工具名（policy=ask 时放行）。 */
  preApproved?: string[];
}

export interface Decision {
  allowed: boolean;
  reason: string;
}

/**
 * ctx.approval：权限预设 + 审批策略。
 * - mode 决定允许哪些风险等级；
 * - behavior=ask 时，write/exec 需要显式预批准（headless 无 TTY，未批准即拒绝）；
 * - write/read 类工具的路径必须落在允许的写根内。
 */
export class ApprovalPolicy {
  mode: PermissionMode;
  behavior: ApprovalBehavior;
  private readonly cwd: string;
  private readonly writeRoots: string[];
  private readonly preApproved: Set<string>;

  constructor(options: ApprovalOptions = {}) {
    this.mode = options.mode ?? 'read-only';
    this.behavior = options.behavior ?? 'never';
    this.cwd = options.cwd ?? process.cwd();
    this.writeRoots = (options.writeRoots ?? [this.cwd]).map((root) => path.resolve(root));
    this.preApproved = new Set(options.preApproved ?? []);
  }

  allowTool(name: string): void {
    this.preApproved.add(name);
  }

  addWriteRoot(root: string): void {
    this.writeRoots.push(path.resolve(root));
  }

  roots(): string[] {
    return this.writeRoots.slice();
  }

  decide(tool: Tool, args: Record<string, unknown>): Decision {
    if (!MODE_RISKS[this.mode].includes(tool.risk)) {
      return { allowed: false, reason: `permission mode "${this.mode}" does not allow ${tool.risk} tools` };
    }
    if (tool.risk !== 'read' && this.behavior === 'ask' && !this.preApproved.has(tool.name)) {
      return {
        allowed: false,
        reason: `approval required for "${tool.name}" (policy=ask); pre-approve it or use --approval-policy never`,
      };
    }
    const target = args['path'];
    if (typeof target === 'string' && (tool.name === 'read_file' || tool.name === 'write_file' || tool.name === 'list_dir')) {
      const resolved = path.resolve(this.cwd, target);
      if (!this.writeRoots.some((root) => isInside(root, resolved))) {
        return { allowed: false, reason: `path "${target}" is outside allowed workspace roots` };
      }
    }
    return { allowed: true, reason: '' };
  }
}

export function permissionModes(): PermissionMode[] {
  return ['read-only', 'workspace-write', 'full-access'];
}
