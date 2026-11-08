import type { EventBus } from '../core/events.js';
import type { ScopeKey } from '../core/types.js';
import { newScopeKey } from '../core/scope.js';
import { newId } from '../util/id.js';
import type { Agent, AgentStatus, CreateAgentOptions } from './types.js';

/** ctx.agents：活 Agent 注册表；创建时发出串行 agent/created。 */
export class AgentRegistry {
  private readonly agents = new Map<string, Agent>();

  constructor(private readonly events: EventBus) {}

  async create(options: CreateAgentOptions): Promise<Agent> {
    const id = newId('agent');
    const scope: ScopeKey = newScopeKey(id);
    const agent: Agent = {
      id,
      sessionId: options.sessionId,
      scope,
      status: 'idle',
      meta: options.meta ?? {},
    };
    this.agents.set(id, agent);
    await this.events.emit('agent/created', { agent });
    return agent;
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  list(): Agent[] {
    return [...this.agents.values()];
  }

  setStatus(id: string, status: AgentStatus): void {
    const agent = this.agents.get(id);
    if (agent) agent.status = status;
  }

  remove(id: string): void {
    this.agents.delete(id);
  }
}
