import type { Component } from 'svelte';

import { Condition, type Fact } from '@runlith/layer/condition';
import { Failure } from '@runlith/layer/Failure';
import { isGenerator } from '@runlith/layer/Graph';
import { Layer } from '@runlith/layer/Layer';
import { Scope } from '@runlith/layer/Scope';
import { Service, type AnyKey, type KeyClass, type Tier } from '@runlith/layer/key';
import { Handoff } from '@runlith/layer/Handoff';

import { Dialogs } from './DialogRegistry.svelte.js';
import { Launchers } from './Launchers.svelte.js';
import { specOf, type OverlayAs, type OverlayMatcher, type OverlayPolicy } from './overlay-policy.js';
import { overlayLayers } from './OverlayLayers.svelte.js';
import { OverlayQueue, type Materialized, type OverlayReport } from './OverlayQueue.svelte.js';
import type { OverlayState } from './overlay-plan.js';
import type { DialogOpenOptions, OverlayHandle } from './types.js';

export interface OverlayDefinition {
  readonly as: OverlayAs;
  readonly tier?: Tier;
  readonly dialog?: Omit<DialogOpenOptions, 'key'>;
}

export class OverlayBinding<Props extends Record<string, unknown>> {
  view: Component<Props> | undefined;

  constructor(
    readonly load: (() => Promise<{ readonly default: Component<Props> }>) | undefined,
    readonly policy: OverlayPolicy | undefined,
    view?: Component<Props>,
    readonly tier: Tier = 'app',
  ) {
    this.view = view;
  }
}

type ExactMatcher<M> = OverlayMatcher & { readonly [K in Exclude<keyof M, keyof OverlayMatcher>]: never };

type ExactMatchers<A> = A extends readonly (infer M)[] ? readonly ExactMatcher<M>[] : A;

type MatcherField = 'suspends' | 'yieldsTo' | 'allowCoexistWith' | 'disallowCoexistWith';

export type ExactPolicy<P> = OverlayPolicy & {
  readonly [K in Exclude<keyof P, keyof OverlayPolicy>]: never;
} & {
  readonly [K in Extract<keyof P, MatcherField>]?: ExactMatchers<P[K]>;
};

export type OverlayPolicyRecipe<P extends OverlayPolicy = OverlayPolicy> = () => Generator<AnyKey, P, unknown> | P;

export type OverlayKeyClass<Id extends string, Props extends Record<string, unknown>> = KeyClass<Id, OverlayBinding<Props>> & {
  readonly as: OverlayAs;
  readonly definition: OverlayDefinition;
  present<P extends ExactPolicy<P> = OverlayPolicy>(view: Component<Props>, policy?: OverlayPolicyRecipe<P>): Layer<never, never>;
  presentLazy<P extends ExactPolicy<P> = OverlayPolicy>(
    load: () => Promise<{ readonly default: Component<Props> }>,
    policy?: OverlayPolicyRecipe<P>,
  ): Layer<never, never>;
};

export type OverlayKeyRef = { readonly id: string };

export class OverlayNotBound extends Error {
  constructor(readonly id: string) {
    super(`Overlay "${id}" has no present() in this manifest: nothing says what to render`);
    this.name = 'OverlayNotBound';
  }
}

export interface OverlayOpenOptions {
  readonly scope?: Scope;
  readonly within?: OverlayKeyRef;
  readonly dialog?: Omit<DialogOpenOptions, 'key'>;
}

export class Overlay extends Service<Overlay>()('Overlay', { tier: 'app' }) {
  static *make() {
    return new Overlay(yield* Dialogs, yield* Launchers, yield* Handoff, yield* Failure, yield* Scope);
  }

  static define<Props extends Record<string, unknown> = Record<string, never>>() {
    return <const Id extends string>(id: Id, definition: OverlayDefinition): OverlayKeyClass<Id, Props> => {
      const tier: Tier = definition.tier ?? 'app';

      const key = class extends Service<OverlayBinding<Props>>()(id, { tier, eager: true }) {
        static readonly as: OverlayAs = definition.as;
        static readonly definition: OverlayDefinition = definition;

        static present<P extends ExactPolicy<P> = OverlayPolicy>(
          view: Component<Props>,
          policy?: OverlayPolicyRecipe<P>,
        ): Layer<never, never> {
          return bind(new OverlayBinding<Props>(undefined, undefined, view, tier), policy);
        }

        static presentLazy<P extends ExactPolicy<P> = OverlayPolicy>(
          load: () => Promise<{ readonly default: Component<Props> }>,
          policy?: OverlayPolicyRecipe<P>,
        ): Layer<never, never> {
          return bind(new OverlayBinding<Props>(load, undefined, undefined, tier), policy);
        }
      };

      const join = Layer.member(
        () => Overlay,
        (overlay: Overlay, bound: OverlayBinding<Props>) => {
          overlay.bind(id, bound as OverlayBinding<Record<string, unknown>>);
          return () => overlay.unbind(id, bound as OverlayBinding<Record<string, unknown>>);
        },
      );

      function bind(binding: OverlayBinding<Props>, policy: OverlayPolicyRecipe | undefined): Layer<never, never> {
        return join(
          Layer.provide(key as never, function* () {
            const resolved = policy ? yield* runRecipe(policy) : undefined;
            return new OverlayBinding<Props>(binding.load, resolved, binding.view, tier) as never;
          }) as never,
        ) as Layer<never, never>;
      }

      declared.add(key as unknown as OverlayKeyClass<string, Record<string, unknown>>);
      return key as unknown as OverlayKeyClass<Id, Props>;
    };
  }

  static get declared(): readonly OverlayKeyClass<string, Record<string, unknown>>[] {
    return [...declared];
  }

  private readonly bindings = new Map<string, OverlayBinding<Record<string, unknown>>>();
  private readonly queue: OverlayQueue;

  readonly foreignDialogOpen = Condition.of(() => this.dialogs.anyOpenExcept(this.arbitratedKeys()));

  private arbitratedKeys(): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const [id, binding] of this.bindings) if (binding.policy) keys.add(id);
    return keys;
  }

  constructor(
    private readonly dialogs: Dialogs,
    private readonly launchers: Launchers,
    handoff: Handoff,
    failure: Failure,
    private readonly scope: Scope,
  ) {
    super();
    this.queue = new OverlayQueue(scope, (reason) => failure.report(reason));

    scope.defer(handoff.onLeave((rung) => this.closeRung(rung)));

    $effect(() => {
      this.queue.observe();
      this.queue.pass();
    });
  }

  bind(id: string, binding: OverlayBinding<Record<string, unknown>>): void {
    this.bindings.set(id, binding);
  }

  unbind(id: string, binding: OverlayBinding<Record<string, unknown>>): void {
    if (this.bindings.get(id) !== binding) return;
    this.bindings.delete(id);
    this.queue.close(id);
  }

  binds(id: string): boolean {
    return this.bindings.has(id);
  }

  declaredHere(): readonly OverlayKeyClass<string, Record<string, never>>[] {
    return Overlay.declared.filter((key) => this.binds(key.id)) as unknown as readonly OverlayKeyClass<string, Record<string, never>>[];
  }

  anyOf(...keys: readonly { readonly id: string }[]): Fact {
    const ids = keys.map((key) => key.id);
    return Condition.of(() => ids.some((id) => this.queue.showing(id)));
  }

  isOpen(key: OverlayKeyRef): boolean {
    return this.queue.stateOf(key.id) !== undefined;
  }

  peekOpen(key: OverlayKeyRef): boolean {
    return this.queue.peekState(key.id) !== undefined;
  }

  stateOf(id: string): OverlayState | undefined {
    return this.queue.stateOf(id);
  }

  snapshot(): OverlayReport {
    return this.queue.report();
  }

  closeAll(): void {
    this.queue.closeAll();
    this.dialogs.closeAll();
    this.launchers.closeAll();
  }

  private closeRung(rung: string): void {
    for (const [id, binding] of this.bindings) {
      if (binding.tier === 'app') continue;
      if (this.scope.graph?.rungOf(binding.tier)?.name !== rung) continue;
      this.queue.close(id);
    }
  }

  close(key: OverlayKeyRef, result?: unknown): void {
    this.queue.close(key.id, result);
  }

  open<Id extends string, Props extends Record<string, unknown>>(
    key: OverlayKeyClass<Id, Props>,
    props: Props,
    options: OverlayOpenOptions = {},
  ): OverlayHandle {
    const binding = this.bindings.get(key.id);
    if (!binding) throw new OverlayNotBound(key.id);
    if (key.as === 'dialog') overlayLayers.intend();

    const view = () => binding.view as Component<Props>;
    const handle = this.queue.open({
      spec: specOf(key.id, key.as, binding.policy, options.within?.id),
      prepare: binding.load && (() => binding.load!().then((module) => void (binding.view = module.default))),
      materialize: () => this.materialize(key, view(), props, options),
      refresh: (live) => {
        if (live.reopen && !live.reopen()) return false;
        live.apply?.(this.presentationOf(key, options));
        live.update?.(props);
        return true;
      },
    });

    handle.presented.catch(() => undefined);
    handle.closed.catch(() => undefined);

    const scope = options.scope;
    if (!scope) return handle;

    const presented = scope.await(handle.presented);
    const closed = scope.await(handle.closed);
    presented.catch(() => undefined);
    closed.catch(() => undefined);

    return { ...handle, presented, closed };
  }

  private presentationOf<Id extends string, Props extends Record<string, unknown>>(
    key: OverlayKeyClass<Id, Props>,
    options: OverlayOpenOptions,
  ): Record<string, unknown> {
    if (key.as === 'launcher') return {};
    return { ...key.definition.dialog, ...options.dialog };
  }

  private materialize<Id extends string, Props extends Record<string, unknown>>(
    key: OverlayKeyClass<Id, Props>,
    view: Component<Props>,
    props: Props,
    options: OverlayOpenOptions,
  ): Materialized {
    switch (key.as) {
      case 'dialog':
        return this.dialogs.open(view, props, { ...key.definition.dialog, ...options.dialog, key: key.id });
      case 'launcher':
        return this.launchers.open(view, props, { key: key.id });
    }
  }
}

function* runRecipe(recipe: OverlayPolicyRecipe): Generator<never, OverlayPolicy, unknown> {
  const made = recipe();
  if (!isGenerator<OverlayPolicy>(made)) return made;
  return yield* made as Generator<never, OverlayPolicy, unknown>;
}

const declared = new Set<OverlayKeyClass<string, Record<string, unknown>>>();
