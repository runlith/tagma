import { note } from '@runlith/activity/Activity';
import { sha256 } from '@runlith/utils/sha256';
import { Clock, Effect } from 'effect';
import { Registry } from '../../registry/Registry';
import type { AgentStep } from '../AgentStep';
import type { ToolCatalog } from '../ToolCatalog';
import type { AgentNote } from '../activities';
import { AgentRuleFailed } from '../AgentFailure';
import type { Message } from '@runlith/llm/schema/messages';
import type { ToolChoiceMode } from '@runlith/llm/schema/options';
import type { AgentRunState } from '../AgentRunState';
import type { AgentHook } from '../contracts';
import type { ToolShown } from '../tool';

const SLOW_RULE_MS = 100;

export type AgentToolCall = {
  readonly name: string;
  readonly input: unknown;
  readonly output?: unknown;
  readonly toolCallId?: string;
  readonly shown?: readonly ToolShown[];
};

export type AgentDirective =
  | {
      readonly type: 'guide';
      readonly text: string;
      readonly ruleId?: string;
      readonly state?: Readonly<Record<string, unknown>>;
      readonly retell?: false;
    }
  | { readonly type: 'restrict'; readonly tools: readonly string[]; readonly ruleId?: string }
  | { readonly type: 'exclude'; readonly tools: readonly string[]; readonly ruleId?: string }
  | { readonly type: 'require'; readonly tool?: string; readonly text?: string; readonly ruleId?: string }
  | { readonly type: 'request'; readonly tool: string; readonly text: string; readonly ruleId?: string };
export type AgentGuideDirective = AgentDirective & { readonly type: 'guide' };

type AgentInvocationFacts = {
  readonly tool?: AgentToolCall;
};

type AgentHookFacts =
  | { readonly hook: 'beforeStep'; readonly modelMessages: readonly Message[]; readonly readerInputs?: readonly string[] }
  | {
      readonly hook: 'beforeClose';
      readonly modelMessages: readonly Message[];
      readonly steps: readonly AgentStep[];
      readonly catalog: ToolCatalog;
    }
  | { readonly hook: Exclude<AgentHook, 'beforeStep' | 'beforeClose'>; readonly modelMessages?: readonly Message[] };

type AgentRunFacts = AgentInvocationFacts &
  AgentHookFacts & {
    readonly runId: string;
    readonly run: AgentRunState;
  };

type AgentEvaluationPosition = {
  readonly invocationKey: string;
  readonly ordinal: number;
};

export type AgentEvaluationFacts = AgentInvocationFacts & AgentHookFacts & AgentEvaluationPosition;

export type AgentRuleContext<TCtx = unknown> = TCtx &
  AgentRunFacts & {
    chance(p: number): boolean;
    everyNth(n: number): boolean;
    cooldown(scope: 'run', n: number): boolean;
  };

export type AgentRuleDescriptor = {
  readonly id: string;
  readonly owner: string;
  readonly hook?: AgentHook;
  readonly priority: number;
  readonly critical?: boolean;
};

export type AgentRule<TCtx = unknown> = ((ctx: AgentRuleContext<TCtx>) => Effect.Effect<AgentDirective | null, unknown>) &
  AgentRuleDescriptor;

export type AgentRuleOptions = {
  readonly owner: string;
  readonly hook?: AgentHook;
  readonly priority?: number;
  readonly critical?: boolean;
};

export type AgentEvaluationInput<TCtx = unknown> = TCtx & AgentRunFacts & AgentEvaluationPosition;

export function agentRule<TCtx = unknown>(
  id: string,
  rule: (ctx: AgentRuleContext<TCtx>) => Effect.Effect<AgentDirective | null, unknown> | AgentDirective | null,
  options: AgentRuleOptions,
): AgentRule<TCtx> {
  const evaluate = (ctx: AgentRuleContext<TCtx>): Effect.Effect<AgentDirective | null, unknown> => {
    const value = rule(ctx);
    return Effect.isEffect(value) ? value : Effect.succeed(value);
  };
  return Object.assign(evaluate, {
    id,
    owner: options.owner,
    priority: options.priority ?? 0,
    hook: options.hook,
    critical: options.critical ? true : undefined,
  });
}

export function orderedRules<TCtx>(rules: readonly AgentRule<TCtx>[]): readonly AgentRule<TCtx>[] {
  return rules
    .map((rule, at) => ({ rule, at }))
    .sort((a, b) => a.rule.priority - b.rule.priority || a.at - b.at)
    .map(({ rule }) => rule);
}

export type AgentRuleSource<TCtx, Setup extends object> = {
  readonly id: string;
  readonly create: (setup: Setup) => AgentRule<TCtx>;
};

export class AgentRuleRegistry<TCtx, Setup extends object> {
  private readonly sources: Registry<AgentRuleSource<TCtx, Setup>>;
  private readonly compiled = new WeakMap<Setup, { readonly revision: number; readonly rules: readonly AgentRule<TCtx>[] }>();

  constructor(seed: readonly { readonly owner: string; readonly entry: AgentRuleSource<TCtx, Setup> }[] = []) {
    this.sources = new Registry(
      'agent rule',
      seed.map(({ owner, entry }) => ({ id: entry.id, owner, value: entry })),
    );
  }

  register(owner: string, source: AgentRuleSource<TCtx, Setup>) {
    return this.sources.register(source.id, owner, source);
  }

  hold(owner: string, source: AgentRuleSource<TCtx, Setup>) {
    return this.sources.hold(source.id, owner, source);
  }

  rules(setup: Setup): readonly AgentRule<TCtx>[] {
    let compiled = this.compiled.get(setup);
    if (compiled === undefined || compiled.revision !== this.sources.revision) {
      compiled = { revision: this.sources.revision, rules: orderedRules(this.sources.values().map((source) => source.create(setup))) };
      this.compiled.set(setup, compiled);
    }
    return compiled.rules;
  }
}

export class AgentRuntimePolicy<TCtx = unknown> {
  private readonly rules: readonly AgentRule<TCtx>[];

  constructor(rules: readonly AgentRule<TCtx>[]) {
    this.rules = orderedRules(rules);
  }

  evaluate(input: AgentEvaluationInput<TCtx>): Effect.Effect<readonly AgentDirective[], AgentRuleFailed> {
    const rules = this.rules;
    return Effect.gen(function* () {
      const directives: AgentDirective[] = [];
      for (const rule of rules) {
        if (rule.hook !== undefined && rule.hook !== input.hook) continue;
        let gateIndex = 0;
        const nextGateIndex = () => {
          gateIndex += 1;
          return gateIndex;
        };
        const ctx = {
          ...input,
          chance: (p: number) => {
            return chance(seed(input.runId, rule.id, input.hook, input.invocationKey, nextGateIndex()), p);
          },
          everyNth: (n: number) => {
            nextGateIndex();
            return input.ordinal > 0 && input.ordinal % n === 0;
          },
          cooldown: (_scope: 'run', n: number) => {
            nextGateIndex();
            if (n <= 1) return true;
            return input.ordinal > 0 && (input.ordinal - 1) % n === 0;
          },
        } satisfies AgentRuleContext<TCtx>;
        const invokeStarted = yield* Clock.monotonicTimeNanos;
        const called = yield* Effect.try({
          try: () => rule(ctx),
          catch: (cause) => new AgentRuleFailed({ ruleId: rule.id, cause }),
        }).pipe(
          Effect.map((value) => ({ ok: true, value }) as const),
          Effect.catchTag('AgentRuleFailed', (error) => Effect.succeed({ ok: false, error } as const)),
        );
        const settleStarted = yield* Clock.monotonicTimeNanos;
        const invokeMs = elapsedMs(invokeStarted, settleStarted);
        const answered = !called.ok
          ? ({ matched: false, error: called.error } as const)
          : yield* called.value.pipe(
              Effect.mapError((cause) => new AgentRuleFailed({ ruleId: rule.id, cause })),
              Effect.catchDefect((cause) => Effect.fail(new AgentRuleFailed({ ruleId: rule.id, cause }))),
              Effect.map((directive) => ({ matched: true, directive }) as const),
              Effect.catchTag('AgentRuleFailed', (error) => Effect.succeed({ matched: false, error } as const)),
            );
        const settleMs = elapsedMs(settleStarted, yield* Clock.monotonicTimeNanos);
        const run = { run: input.runId };
        if (!answered.matched) {
          const failed = answered.error;
          if (rule.critical) return yield* Effect.fail(failed);
          yield* note<AgentNote>(
            { type: 'rule-failed', ruleId: rule.id, owner: rule.owner, hook: input.hook, message: failed.message },
            run,
          );
          continue;
        }
        if (answered.directive) directives.push({ ...answered.directive, ruleId: rule.id } satisfies AgentDirective);
        if (invokeMs >= SLOW_RULE_MS || settleMs >= SLOW_RULE_MS) {
          yield* note<AgentNote>({ type: 'rule-slow', ruleId: rule.id, owner: rule.owner, hook: input.hook, invokeMs, settleMs }, run);
        }
      }
      return directives as readonly AgentDirective[];
    });
  }
}

export function agentGuidance(directives: readonly AgentDirective[]): string[] {
  return agentGuides(directives).map((directive) => directive.text);
}

export function agentGuides(directives: readonly AgentDirective[]): AgentGuideDirective[] {
  return directives.flatMap((directive): AgentGuideDirective[] => {
    if (directive.type === 'guide') return [directive];
    if ((directive.type === 'require' || directive.type === 'request') && directive.text !== undefined) {
      return [{ type: 'guide', text: directive.text, ruleId: directive.ruleId }];
    }
    return [];
  });
}

export type AgentStepToolPolicy = {
  readonly activeTools: readonly string[] | null;
  readonly toolChoice: { type: 'tool'; toolName: string } | 'required' | null;
};

export function agentStepToolPolicy(
  directives: readonly AgentDirective[],
  catalog: readonly string[],
  toolChoice?: readonly ToolChoiceMode[],
): AgentStepToolPolicy {
  const restrictions = directives.flatMap((directive) => (directive.type === 'restrict' ? [directive.tools] : []));
  const excluded = new Set(directives.flatMap((directive) => (directive.type === 'exclude' ? directive.tools : [])));
  let active: string[] | null = null;
  if (restrictions.length > 0 || excluded.size > 0) {
    active = catalog.slice();
    for (const restriction of restrictions) {
      const allowed = new Set(restriction);
      active = active.filter((toolName) => allowed.has(toolName));
    }
    active = active.filter((toolName) => !excluded.has(toolName));
  }
  const demand =
    directives.find((directive) => directive.type === 'require') ?? directives.find((directive) => directive.type === 'request');
  if (!demand) return { activeTools: active, toolChoice: null };
  if (!demand.tool) return { activeTools: active, toolChoice: 'required' };
  if (excluded.has(demand.tool) || !catalog.includes(demand.tool)) return { activeTools: active, toolChoice: null };
  if (active && !active.includes(demand.tool)) active = [...active, demand.tool];
  if (demand.type === 'request' && toolChoice !== undefined && !toolChoice.includes('tool')) {
    return { activeTools: active, toolChoice: null };
  }
  return { activeTools: active, toolChoice: { type: 'tool', toolName: demand.tool } };
}

function elapsedMs(from: bigint, to: bigint): number {
  return Number(to - from) / 1_000_000;
}

function seed(runId: string, ruleId: string, hook: AgentHook, invocationKey: string, gateIndex: number): string {
  return [runId, ruleId, hook, invocationKey, String(gateIndex)].join(':');
}

function chance(value: string, p: number): boolean {
  if (p <= 0) return false;
  if (p >= 1) return true;
  const hex = sha256().update(value).digest('hex').slice(0, 12);
  const sample = Number.parseInt(hex, 16) / 0xffffffffffff;
  return sample < p;
}
