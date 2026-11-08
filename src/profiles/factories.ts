import type { PluginFactory } from '../core/plugin.js';
import { Credentials, Settings, Telemetry, localFs } from '../core/services.js';
import { SessionStore } from '../session/store.js';
import { LlmRegistry } from '../llm/registry.js';
import { createDeepSeekAdapter } from '../llm/deepseek.js';
import { createMockAdapter } from '../llm/mock.js';
import { ToolRegistry } from '../tools/registry.js';
import { createBuiltinTools } from '../tools/builtin.js';
import { ApprovalPolicy } from '../tools/approval.js';
import type { PreExecutePayload } from '../tools/types.js';
import { SystemPromptAssembler } from '../prompt/assembler.js';
import { AgentRegistry } from '../agent/registry.js';
import { AgentLoop } from '../agent/loop.js';
import { CommandRegistry } from '../commands/registry.js';
import { registerBuiltinCommands } from '../commands/builtin.js';
import { createHeadlessApp } from '../apps/headless.js';
import { createTuiApp } from '../apps/tui.js';
import { createWebApp } from '../apps/web.js';
import { createSdkApp } from '../apps/sdk.js';
import { createAcpApp } from '../apps/acp.js';
import type { App, Runtime } from '../apps/runtime.js';

/**
 * 插件工厂表：配置树里每个 `use` 都对应这里的一项。
 * 连 agent-loop、工具注册表、app 本身都是可替换的一行 —— everything is a plugin。
 */
export function createFactories(runtime: Runtime): Map<string, PluginFactory> {
  const factories = new Map<string, PluginFactory>();

  factories.set('core/settings', (ctx) => {
    ctx.provide('settings', new Settings({ model: runtime.model, profile: runtime.profileName }));
  });

  factories.set('core/credentials', (ctx) => {
    ctx.provide('credentials', new Credentials());
  });

  factories.set('core/telemetry', (ctx) => {
    ctx.provide('telemetry', new Telemetry());
  });

  factories.set('fs/local', (ctx) => {
    ctx.provide('fs', localFs(runtime.cwd, runtime.home));
  });

  factories.set('core/sessions', (ctx) => {
    ctx.provide('sessions', new SessionStore(runtime.home));
  });

  factories.set('core/llm', (ctx) => {
    ctx.provide('llm', new LlmRegistry());
  });

  factories.set('llm/deepseek', (ctx) => {
    ctx.get<LlmRegistry>('llm').register(createDeepSeekAdapter());
  });

  factories.set('llm/mock', (ctx) => {
    ctx.get<LlmRegistry>('llm').register(createMockAdapter());
  });

  factories.set('core/approval', (ctx) => {
    const policy = new ApprovalPolicy({
      mode: runtime.permissionMode,
      behavior: runtime.approvalBehavior,
      cwd: runtime.cwd,
      writeRoots: runtime.writeRoots,
    });
    ctx.provide('approval', policy);
    const handle = ctx.events.on<PreExecutePayload>('tools/pre-execute', async (payload, next) => {
      if (payload.tool) {
        const decision = policy.decide(payload.tool, payload.call.args);
        if (!decision.allowed) {
          payload.rejected = true;
          payload.reason = decision.reason;
        }
      }
      await next();
    });
    ctx.onDispose(() => handle.dispose());
  });

  factories.set('core/tools', (ctx) => {
    ctx.provide('tools', new ToolRegistry(ctx.events, runtime.cwd));
  });

  factories.set('tools/builtin', (ctx) => {
    const registry = ctx.get<ToolRegistry>('tools');
    for (const tool of createBuiltinTools(runtime.cwd)) {
      const handle = registry.register(tool);
      ctx.onDispose(() => handle.dispose());
    }
  });

  factories.set('core/system-prompt', (ctx) => {
    ctx.provide('systemPrompt', new SystemPromptAssembler(ctx.get<ToolRegistry>('tools')));
  });

  factories.set('core/agents', (ctx) => {
    ctx.provide('agents', new AgentRegistry(ctx.events));
  });

  factories.set('core/agent-loop', (ctx, config) => {
    const maxSteps = typeof config.maxSteps === 'number' ? config.maxSteps : runtime.maxSteps;
    const loop = new AgentLoop({
      sessions: ctx.get<SessionStore>('sessions'),
      llm: ctx.get<LlmRegistry>('llm'),
      tools: ctx.get<ToolRegistry>('tools'),
      prompt: ctx.get<SystemPromptAssembler>('systemPrompt'),
      agents: ctx.get<AgentRegistry>('agents'),
      events: ctx.events,
      maxSteps,
      model: runtime.model,
      cwd: runtime.cwd,
    });
    ctx.provide('agentLoop', loop);
  });

  factories.set('core/commands', (ctx) => {
    ctx.provide('commands', new CommandRegistry());
  });

  factories.set('commands/builtin', (ctx) => {
    registerBuiltinCommands(ctx.get<CommandRegistry>('commands'), runtime, ctx);
  });

  const provideApp = (app: App): PluginFactory => (ctx) => {
    ctx.provide('app', app);
  };

  factories.set('app/headless', provideApp(createHeadlessApp()));
  factories.set('app/tui', provideApp(createTuiApp()));
  factories.set('app/sdk', provideApp(createSdkApp()));
  factories.set('app/acp', provideApp(createAcpApp()));
  factories.set('app/web', (ctx, config) => {
    if (typeof config.port === 'number') runtime.options.port = config.port;
    if (typeof config.host === 'string') runtime.options.host = config.host;
    ctx.provide('app', createWebApp());
  });

  return factories;
}

/** 供 CLI 做前置校验：所有配置行的 use 都必须有工厂。 */
export function factoryNames(factories: Map<string, PluginFactory>): string[] {
  return [...factories.keys()].sort();
}
