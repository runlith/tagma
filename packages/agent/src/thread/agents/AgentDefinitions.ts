import type { Effect } from 'effect';
import { agentRule, type AgentRule } from '../../agent/policy/AgentRuntimePolicy';
import type { ToolGrant, ToolGrantSource } from '../../catalog/resolveCatalog';
import { Registry, type RegistryCollision } from '../../registry/Registry';
import type { AgentProfile } from './AgentProfile';

export type AgentCapability<TCtx> = {
  readonly id: string;
  readonly description: string;
  readonly rules?: readonly AgentRule<TCtx>[];
  readonly runtimeSources?: readonly string[];
  readonly source?: { readonly id: string };
  readonly explicit?: true;
  readonly joins?: readonly string[];
};

export type AgentDeclared = {
  readonly id: string;
  readonly identity: string;
  readonly capabilities: readonly string[] | 'every';
  readonly sources: readonly string[];
  readonly compaction?: string;
};

export type DerivedAgent<C> = {
  readonly held: readonly C[];
  readonly declared: readonly C[];
  readonly sources: readonly string[];
  readonly grant: ToolGrant;
};

export type OverlayNarrowing = {
  readonly capabilities: readonly string[];
  readonly runtimeSources: readonly string[];
};

export type EffectiveAgent<C> = DerivedAgent<C> & { readonly identity: string };

function overlayHolds(overlay: AgentProfile | undefined, capability: string): boolean {
  return overlay?.capabilities === undefined || overlay.capabilities.includes(capability);
}

export function capabilityHolds(overlay: AgentProfile | undefined, capability: { readonly id: string; readonly explicit?: true }): boolean {
  return capability.explicit === true ? overlay?.capabilities?.includes(capability.id) === true : overlayHolds(overlay, capability.id);
}

export type RuntimeStanding = (source: string) => readonly string[] | undefined;

type Derived<C> = { readonly revision: number; readonly value: DerivedAgent<C> };

export class AgentDefinitions<TCtx, C extends AgentCapability<TCtx>> {
  private readonly contributions = new Registry<C>('agent capability');
  private readonly derived = new WeakMap<AgentDeclared, Map<string, Derived<C>>>();
  private readonly ruled = new WeakMap<AgentDeclared, { readonly revision: number; readonly rules: readonly AgentRule<TCtx>[] }>();

  constructor(
    private readonly standing: RuntimeStanding = () => undefined,
    private readonly everywhere: readonly ToolGrantSource[] = [],
  ) {}

  register(owner: string, contribution: C): Effect.Effect<() => void, RegistryCollision> {
    return this.contributions.register(contribution.id, owner, contribution);
  }

  find(id: string): C | undefined {
    return this.contributions.find(id);
  }

  list(): readonly C[] {
    return this.contributions.values();
  }

  effective(declared: AgentDeclared, overlay?: AgentProfile): EffectiveAgent<C> {
    const key = overlay?.capabilities?.join('\u0000') ?? '*';
    const revision = this.contributions.revision;
    let byOverlay = this.derived.get(declared);
    if (byOverlay === undefined) {
      byOverlay = new Map();
      this.derived.set(declared, byOverlay);
    }
    let derived = byOverlay.get(key);
    if (derived === undefined || derived.revision !== revision) {
      derived = { revision, value: this.derive(declared, overlay) };
      byOverlay.set(key, derived);
    }
    return { identity: overlay?.prompt ?? declared.identity, ...derived.value };
  }

  narrowing(ids: readonly string[]): OverlayNarrowing {
    const held = ids.flatMap((id) => {
      const found = this.contributions.find(id);
      return found === undefined ? [] : [found];
    });
    return {
      capabilities: held.map((contribution) => contribution.id),
      runtimeSources: [...new Set(held.flatMap((contribution) => contribution.runtimeSources ?? []))],
    };
  }

  rules(declared: AgentDeclared, overlayOf: (ctx: TCtx) => AgentProfile | undefined): readonly AgentRule<TCtx>[] {
    const revision = this.contributions.revision;
    const standing = this.ruled.get(declared);
    if (standing !== undefined && standing.revision === revision) return standing.rules;
    const rules = this.effective(declared).declared.flatMap((contribution) =>
      (contribution.rules ?? []).map((rule) =>
        agentRule<TCtx>(rule.id, (ctx) => (this.effective(declared, overlayOf(ctx)).held.includes(contribution) ? rule(ctx) : null), {
          owner: rule.owner,
          priority: rule.priority,
          hook: rule.hook,
          critical: rule.critical ? true : undefined,
        }),
      ),
    );
    this.ruled.set(declared, { revision, rules });
    return rules;
  }

  private derive(declared: AgentDeclared, overlay: AgentProfile | undefined): DerivedAgent<C> {
    const base =
      declared.capabilities === 'every'
        ? this.contributions.values().filter((contribution) => contribution.explicit !== true)
        : [
            ...declared.capabilities.flatMap((id) => {
              const found = this.contributions.find(id);
              return found === undefined ? [] : [found];
            }),
            ...this.contributions
              .values()
              .filter(
                (contribution) => contribution.joins?.includes(declared.id) === true && !declared.capabilities.includes(contribution.id),
              ),
          ];
    const explicit = this.contributions.values().filter((contribution) => contribution.explicit === true && !base.includes(contribution));
    const all = [...base, ...explicit.filter((contribution) => capabilityHolds(overlay, contribution))];
    const held = all.filter((contribution) => capabilityHolds(overlay, contribution));
    const narrowable = [...new Set(all.flatMap((contribution) => contribution.runtimeSources ?? []))];
    const sources: ToolGrantSource[] = [
      { source: declared.id },
      ...narrowable.map((source) => {
        const standing = this.standing(source);
        return { source, narrowable: true as const, standing: standing };
      }),
      ...[...base, ...explicit].flatMap((contribution) => (contribution.source === undefined ? [] : [{ source: contribution.source.id }])),
      ...declared.sources.map((source) => ({ source, standing: true as const })),
      ...this.everywhere,
    ];
    return {
      held,
      declared: all,
      sources: [...new Set(held.flatMap((contribution) => contribution.runtimeSources ?? []))],
      grant: { sources },
    };
  }
}
