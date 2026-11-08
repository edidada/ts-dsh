import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { ensureDir, resolveInside } from '../util/fs.js';
import type { Tool } from './types.js';

function str(args: Record<string, unknown>, key: string, fallback = ''): string {
  const value = args[key];
  return typeof value === 'string' ? value : fallback;
}

function strArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function runCommand(command: string, argv: string[], cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      argv,
      { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024, shell: false },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${error.message}${stderr ? `\n${stderr}` : ''}`));
          return;
        }
        resolve(`${stdout}${stderr ? `\n${stderr}` : ''}`);
      },
    );
  });
}

/** 六个内置工具；参数全部来自模型，路径统一走 resolveInside，命令不经过 shell。 */
export function createBuiltinTools(cwd: string): Tool[] {
  return [
    {
      name: 'echo',
      description: 'Return the given text unchanged. Useful for smoke tests.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      risk: 'read',
      handler: (args) => str(args, 'text'),
    },
    {
      name: 'now',
      description: 'Return the current ISO timestamp.',
      parameters: { type: 'object', properties: {} },
      risk: 'read',
      handler: () => new Date().toISOString(),
    },
    {
      name: 'list_dir',
      description: 'List entries of a directory inside the workspace.',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
      risk: 'read',
      handler: (args, ctx) => {
        const dir = resolveInside(ctx.cwd, str(args, 'path', '.'));
        return fs.readdirSync(dir, { withFileTypes: true })
          .map((entry) => `${entry.isDirectory() ? 'd' : '-'} ${entry.name}`)
          .sort()
          .join('\n');
      },
    },
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file inside the workspace.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      risk: 'read',
      handler: (args, ctx) => fs.readFileSync(resolveInside(ctx.cwd, str(args, 'path')), 'utf8'),
    },
    {
      name: 'write_file',
      description: 'Write a UTF-8 text file inside the workspace.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
      risk: 'write',
      handler: (args, ctx) => {
        const file = resolveInside(ctx.cwd, str(args, 'path'));
        ensureDir(path.dirname(file));
        fs.writeFileSync(file, str(args, 'content'), 'utf8');
        return `wrote ${file}`;
      },
    },
    {
      name: 'run_command',
      description: 'Run an executable with an argv array (no shell). Returns combined stdout/stderr.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } },
        required: ['command'],
      },
      risk: 'exec',
      handler: (args, ctx) => runCommand(str(args, 'command'), strArray(args, 'args'), ctx.cwd, 10_000),
    },
  ];
}
