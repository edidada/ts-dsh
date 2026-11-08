import type { Disposable, ScopeKey } from '../core/types.js';
import type { Message } from '../llm/types.js';
import type { ToolRegistry } from '../tools/registry.js';

export interface PromptSection {
  id: string;
  text: string;
  scope?: ScopeKey;
}

const IDENTITY = 'You are a helpful agent running inside ts-dsh, a teaching clone of DeepSeek Harness. '
  + 'Use the provided tools when needed; tool results come back as `tool` messages.';

/** ctx.systemPrompt：分段装配 + 本 step 准入的工具 schema。 */
export class SystemPromptAssembler {
  private readonly sections: PromptSection[] = [];

  constructor(private readonly tools: ToolRegistry) {}

  add(section: PromptSection): Disposable {
    this.sections.push(section);
    return {
      dispose: () => {
        const index = this.sections.indexOf(section);
        if (index >= 0) this.sections.splice(index, 1);
      },
    };
  }

  sectionsFor(scope?: ScopeKey): PromptSection[] {
    return this.sections.filter((section) => !section.scope || section.scope === scope);
  }

  /** 返回一条 system 消息；工具 schema 以 JSON 形式并入，保证请求可从日志重建。 */
  assemble(scope?: ScopeKey): Message[] {
    const parts = [IDENTITY, ...this.sectionsFor(scope).map((section) => section.text)];
    const schemas = this.tools.schemas(scope);
    if (schemas.length > 0) {
      parts.push(`可用工具（JSON Schema）：\n${JSON.stringify(schemas, null, 2)}`);
    }
    return [{ role: 'system', content: parts.join('\n\n') }];
  }
}
