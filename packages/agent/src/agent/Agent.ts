import type { AgentRule } from './policy/AgentRuntimePolicy';
import type { AgentStopCondition } from './AgentStep';
import type { ToolGrant } from '../catalog/resolveCatalog';
import type { ToolCatalog } from './ToolCatalog';

export type AgentStanding<TCtx> = {
  readonly grant: ToolGrant;
  readonly rules: readonly AgentRule<TCtx>[];
};

export type AgentConfig<TCtx> = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  instructions(ctx: TCtx): string;
  tools(ctx: TCtx): ToolCatalog;
  readonly grant?: ToolGrant;
  readonly rules?: readonly AgentRule<TCtx>[];
  standing?(): AgentStanding<TCtx>;
  readonly stopWhen: readonly AgentStopCondition[];
  readonly parallelToolCalls?: boolean;
  readonly compaction?: string;
};

export class Agent<TCtx = unknown> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly stopWhen: readonly AgentStopCondition[];
  readonly parallelToolCalls: boolean | undefined;
  readonly compaction: string | undefined;
  readonly instructions: (ctx: TCtx) => string;
  readonly tools: (ctx: TCtx) => ToolCatalog;
  private readonly standing: () => AgentStanding<TCtx>;

  constructor(config: AgentConfig<TCtx>) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.stopWhen = config.stopWhen;
    this.parallelToolCalls = config.parallelToolCalls;
    this.compaction = config.compaction;
    this.instructions = config.instructions;
    this.tools = config.tools;
    const fixed: AgentStanding<TCtx> = {
      grant: config.grant ?? { sources: [{ source: config.id }] },
      rules: config.rules ?? [],
    };
    this.standing = config.standing ?? (() => fixed);
  }

  get grant(): ToolGrant {
    return this.standing().grant;
  }

  get rules(): readonly AgentRule<TCtx>[] {
    return this.standing().rules;
  }
}
