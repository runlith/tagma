import { Failure } from './Failure.js';
import { Graph, isGenerator, TierMismatchError, UnknownTierError, type DataBuild, type GraphOptions } from './Graph.js';
import { Handoff } from './Handoff.js';
import {
  isDeferredKey,
  optionalOf,
  type AnyKey,
  type AnyKeyClass,
  type Ask,
  type Deferred,
  type DeferredKeyClass,
  type Key,
  type KeyClass,
  type Provided,
  type Resolver,
  type Tier,
  type TierViolation,
} from './key.js';
import { Layer, type AnyLayer, type Entry, type InOf, type LayerLike, type OutOf, type Satisfying, type When } from './Layer.js';
import { Prepare } from './Prepare.js';
import { placeOf, type AnyRung, type RungInput, type RungOwn } from './Rung.js';
import { Scope, ScopeAbort, type ScopeKey } from './Scope.js';
import { Snapshot } from './Snapshot.js';

export interface AppOptions<L extends readonly AnyRung[] = readonly []> {
  readonly data?: DataBuild;
  readonly ladder?: L;
}

declare const DefinitionTag: unique symbol;

export interface Definition<M extends LayerLike = LayerLike, L extends readonly AnyRung[] = readonly AnyRung[]> {
  readonly [DefinitionTag]?: M;
  readonly manifest: AnyLayer;
  readonly ladder: L;
  readonly data: DataBuild | undefined;
}

export type WorldHooks = Pick<GraphOptions, 'effectRoot' | 'watch' | 'cell'> & {
  readonly start: 'open' | 'mount';
  readonly data?: DataBuild;
};

export type Sources<L> = L extends readonly (infer R)[] ? (R extends AnyRung ? Provided<R['Source']> : never) : never;

export type Currents<L> = L extends readonly (infer R)[] ? (R extends AnyRung ? Provided<R['Current']> | RungOwn<R> : never) : never;

export type Ambient = ScopeKey | Provided<typeof Handoff> | Provided<typeof Prepare> | Provided<typeof Failure> | Provided<typeof Snapshot>;

type Judged<W> =
  W extends TierViolation<infer Id, string>
    ? string extends Id
      ? never
      : W
    : W extends When<Key<infer Id, unknown>, object>
      ? string extends Id
        ? never
        : W
      : W;

export type Missing<M, B = never, L extends readonly AnyRung[] = readonly []> = Judged<
  Exclude<InOf<M> | InOf<B> | Sources<L>, Satisfying<OutOf<M> | OutOf<B> | Ambient | Currents<L>>>
>;

export type Closed<M, B, L extends readonly AnyRung[] = readonly []> = [Missing<M, B, L>] extends [never]
  ? B
  : { readonly 'manifest misses': Missing<M, B, L> };

export type ClosedBy<M, B, L extends readonly AnyRung[] = readonly []> = [Missing<M, B, L>] extends [never]
  ? unknown
  : { readonly 'manifest misses': Missing<M, B, L> };

type OpenScope = {
  readonly key: string;
  readonly scope: Scope;
  ready: Promise<void>;
  left: boolean;
  holders: number;
  readonly retired: Promise<void>;
  readonly retire: (closing: Promise<void>) => void;
};

export interface HeldScope {
  readonly scope: Scope;
  release(): void;
}

export class RungClosedError extends Error {
  constructor(
    readonly id: string,
    readonly tier: Tier,
    readonly rung: string,
    readonly standing?: string,
  ) {
    super(
      standing === undefined
        ? `"${id}" is ${tier}-tier and no ${rung} is open: its source answers nothing`
        : `"${id}" is ${tier}-tier and the open ${rung} is ${standing}`,
    );
  }
}

export class UnknownRungError extends Error {
  constructor(readonly rung: string) {
    super(`Rung "${rung}" is not on this app's ladder`);
  }
}

export interface AppReport {
  readonly scopes: readonly {
    readonly name: string;
    readonly tier: string;
    readonly kind: string | undefined;
    readonly built: readonly { readonly id: string; readonly requires: readonly string[] }[];
  }[];
}

function provides(layer: AnyLayer, key: AnyKeyClass): boolean {
  return layer.items.some((item) => 'key' in item && item.key === key);
}

function distinctNames(ladder: readonly AnyRung[]): void {
  const seen = new Set<string>(['app']);
  for (const rung of ladder) {
    for (const name of [rung.name, ...rung.kinds]) {
      if (seen.has(name)) throw new Error(`Ladder names "${name}" twice: a rung and a kind, or two rungs, cannot share a tier`);
      seen.add(name);
    }
  }
}

function parentsFirst(ladder: readonly AnyRung[]): void {
  const listed = new Set<string>();
  for (const rung of ladder) {
    if (rung.under !== undefined && !listed.has(rung.under.name)) {
      throw new Error(`Rung "${rung.name}" stands under "${rung.under.name}", which the ladder does not list before it`);
    }
    listed.add(rung.name);
  }
}

function standsUnder(rung: AnyRung, above: AnyRung): boolean {
  for (let up = rung.under; up !== undefined; up = up.under) {
    if (up.name === above.name) return true;
  }
  return false;
}

export class MountedApp implements Resolver {
  readonly graph: Graph;
  readonly app: Scope;
  readonly ladder: readonly AnyRung[];
  readonly ready: Promise<void>;
  private readonly open = new Map<string, Map<string, OpenScope>>();
  private started = false;
  private settleReady: () => void = () => undefined;
  private begin: () => void = () => undefined;
  private readonly starting = new Promise<void>((resolve) => {
    this.begin = resolve;
  });
  private readonly retirement = new Map<string, Promise<void>>();
  private readonly arriving = new Map<string, Set<Entry>>();

  constructor(
    readonly definition: Definition,
    world: LayerLike,
    private readonly hooks: WorldHooks,
  ) {
    this.ladder = definition.ladder;
    const filled = (Layer.mergeAll(world) as AnyLayer).items.filter((item) => !('key' in item && provides(definition.manifest, item.key)));
    const merged = Layer.mergeAll(definition.manifest, new Layer(filled)) as AnyLayer;
    const layer = Layer.mergeAll(
      merged,
      provides(merged, Failure) ? Layer.mergeAll() : Failure,
      provides(merged, Snapshot) ? Layer.mergeAll() : Snapshot,
      provides(merged, Handoff) ? Layer.mergeAll() : Layer.provide(Handoff, () => new Handoff((rung, input) => this.readyAt(rung, input))),
      provides(merged, Prepare) ? Layer.mergeAll() : Layer.of(Prepare, (rung, input) => this.prepare(rung, input)),
    ) as AnyLayer;
    this.graph = new Graph(layer, {
      effectRoot: hooks.effectRoot,
      watch: hooks.watch,
      cell: hooks.cell,
      data: hooks.data ?? definition.data,
      ladder: this.ladder,
      report: (error) => this.fail(error),
    });
    for (const rung of this.ladder) {
      this.open.set(rung.name, new Map());
      this.retirement.set(rung.name, Promise.resolve());
    }
    this.app = Scope.make();
    this.ready = new Promise<void>((resolve) => {
      this.settleReady = resolve;
    });
    try {
      void this.graph.open(this.app, [], false);
      if (hooks.start === 'open') this.start();
    } catch (error) {
      void this.close();
      throw error;
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.begin();
    const pending = [
      this.graph.start(this.app),
      ...this.openScopes().map((open) => {
        open.ready = this.graph.start(open.scope);
        return open.ready;
      }),
    ];
    void this.observe(Promise.all(pending).then(() => undefined)).then(() => this.settleReady());
  }

  alwaysOpen(): Tier {
    let deepest: Tier = 'app';
    const open = new Set<string>(['app']);
    for (const rung of this.ladder) {
      if (!rung.always || !open.has(rung.under?.name ?? 'app')) continue;
      open.add(rung.name);
      deepest = rung.name as Tier;
    }
    return deepest;
  }

  get failure(): Failure {
    return this.graph.resolve(Failure, this.app);
  }

  get snapshot(): Snapshot {
    return this.graph.resolve(Snapshot, this.app);
  }

  scopeOf(tier: Tier, of: string = tier, from?: Scope): Scope {
    if (tier === 'app') return this.app;
    const rung = this.graph.rungOf(tier);
    if (!rung) throw new UnknownRungError(tier);
    const scope = from ? this.inChain(tier, rung, from) : this.focused(tier, rung);
    if (!scope) throw new RungClosedError(of, tier, rung.name, this.standingKind(rung, tier));
    return scope;
  }

  spawn<Self>(scope: Scope, id: string, make: () => Generator<Ask, Self, unknown> | Self): Self {
    return this.graph.spawn<Self>(scope, id, make, {
      answer: (key, from) => this.answer(key as KeyClass<string, unknown>, from),
      find: (key, from) => this.find(key as KeyClass<string, unknown>, from),
    });
  }

  position(): readonly (string | undefined)[] {
    const closed = new Set<string>();
    return this.ladder.map((rung) => {
      const input = rung.under !== undefined && closed.has(rung.under.name) ? undefined : this.graph.resolve(rung.Source, this.app)();
      if (input === undefined) closed.add(rung.name);
      return input === undefined ? undefined : rung.keyOf(input);
    });
  }

  resolve<Self>(key: KeyClass<string, Self>, from?: Scope): Self {
    return this.graph.resolve(key, this.scopeFor(key, from));
  }

  resolveDeferred<Self>(key: DeferredKeyClass<string, Self>, from?: Scope): Promise<Self> {
    const target = key as unknown as KeyClass<string, Self>;
    return this.graph.resolveDeferred(target, this.scopeFor(target, from));
  }

  resolveHandle<Self>(key: DeferredKeyClass<string, Self>, from?: Scope): Deferred<Self> {
    const target = key as unknown as KeyClass<string, Self>;
    return this.graph.resolveHandle(target, this.scopeFor(target, from));
  }

  find<Self>(key: KeyClass<string, Self>, from?: Scope): Self | Deferred<Self> | undefined {
    const scope = this.hostOf(key, from);
    if (!scope || !this.graph.present(key, scope)) return undefined;
    return this.answer(key, from) as Self | Deferred<Self>;
  }

  answer(key: KeyClass<string, unknown>, from?: Scope): unknown {
    return isDeferredKey(key) ? this.resolveHandle(key as unknown as DeferredKeyClass<string, unknown>, from) : this.resolve(key, from);
  }

  hasScope<R extends AnyRung>(rung: R, input: RungInput<R>, under: Scope = this.app): boolean {
    const step = this.rung(rung.name);
    const parent = step.under === undefined ? this.app : under.owner(step.under.name as Tier);
    if (parent === undefined || parent.closed) return false;
    const place = placeOf(parent === this.app ? undefined : parent.name, step.name, step.keyOf(input));
    const opened = this.open.get(step.name)?.get(place);
    return opened !== undefined && !opened.scope.closed;
  }

  hold(rung: AnyRung | string, input: object, under?: Scope): HeldScope {
    const step = this.rung(typeof rung === 'string' ? rung : rung.name);
    const parent = this.parentFor(step, under);
    if (!parent) throw new RungClosedError(step.Current.id, step.name as Tier, (step.under as AnyRung).name);
    const open = this.openAt(step, parent, step.keyOf(input), input);
    open.holders += 1;
    let released = false;
    return {
      scope: open.scope,
      release: () => {
        if (released) return;
        released = true;
        open.holders -= 1;
        if (this.app.closed || open.holders > 0 || this.current().has(open)) return;
        this.leaving(step.name, this.open.get(step.name) as Map<string, OpenScope>, undefined);
        queueMicrotask(() => {
          if (!this.app.closed) void this.adopt();
        });
      },
    };
  }

  async enter(entry: Entry, routeId: string | undefined): Promise<void> {
    await entry.prepare(this.app);
    if (this.hooks.start === 'open') {
      entry.enter(this.app);
      return;
    }
    entry.register(this.app);
    if (routeId === undefined) return;
    let waiting = this.arriving.get(routeId);
    if (!waiting) {
      waiting = new Set();
      this.arriving.set(routeId, waiting);
    }
    waiting.add(entry);
  }

  land(routeId: string | undefined): void {
    if (routeId === undefined) return;
    const waiting = this.arriving.get(routeId);
    if (!waiting) return;
    this.arriving.delete(routeId);
    for (const entry of waiting) entry.enter(this.app);
  }

  prepare(rung: AnyRung | string, input: object): Promise<void> {
    const name = typeof rung === 'string' ? rung : rung.name;
    const step = this.ladder.find((listed) => listed.name === name);
    if (!step) return Promise.reject(new UnknownRungError(name));
    const parent = this.parentFor(step);
    if (!parent) {
      return Promise.reject(new RungClosedError(step.Current.id, step.name as Tier, (step.under as AnyRung).name));
    }
    return this.graph.prefetch(parent, step, input);
  }

  private async readyAt<R extends AnyRung>(rung: R, input: RungInput<R>): Promise<void> {
    this.app.assertOpen();
    const step = this.rung(rung.name);
    const key = step.keyOf(input);
    const current = this.ensure(step);
    if (current?.key !== key) throw new Error(`${step.name} "${key}" is not published`);
    await current.scope.await(this.starting);
    await current.scope.await(Promise.all([current.ready, current.retired]));
    if (this.ensure(step)?.key !== key) throw new Error(`${step.name} "${key}" is no longer published`);
  }

  private rung(name: string): AnyRung {
    const step = this.ladder.find((listed) => listed.name === name);
    if (!step) throw new UnknownRungError(name);
    return step;
  }

  private parentFor(step: AnyRung, from?: Scope): Scope | undefined {
    const above = step.under;
    if (above === undefined) return this.app;
    return from?.owner(above.name as Tier) ?? this.ensure(above)?.scope;
  }

  run<T>(made: Generator<Ask, T, unknown> | T): T {
    if (!isGenerator<T>(made)) return made;
    let step = made.next();
    while (!step.done) {
      const requested: unknown = step.value;
      if (requested === Scope) throw new Error('A load has no scope of its own: yield a key, never Scope');
      const optional = optionalOf(requested);
      step = made.next(optional ? this.find(optional) : this.answer(requested as KeyClass<string, unknown>));
    }
    return step.value;
  }

  ensure(rung: AnyRung | string): OpenScope | undefined {
    const step = this.rung(typeof rung === 'string' ? rung : rung.name);
    const parent = step.under === undefined ? this.app : this.ensure(step.under)?.scope;
    if (!parent) return undefined;
    const current = this.ensureUnder(step, parent);
    if (!current) this.closedUnder(step);
    return current;
  }

  private closedUnder(rung: AnyRung): void {
    for (const below of this.ladder) {
      if (standsUnder(below, rung)) this.leaving(below.name, this.open.get(below.name) as Map<string, OpenScope>, undefined);
    }
  }

  private ensureUnder(rung: AnyRung, parent: Scope): OpenScope | undefined {
    const input = this.graph.resolve(rung.Source, this.app)();
    const byPlace = this.open.get(rung.name) as Map<string, OpenScope>;
    if (input === undefined) {
      this.leaving(rung.name, byPlace, undefined);
      return undefined;
    }
    const key = rung.keyOf(input);
    const place = placeOf(parent === this.app ? undefined : parent.name, rung.name, key);
    const existing = byPlace.get(place);
    if (existing) {
      existing.left = false;
      return existing;
    }
    this.leaving(rung.name, byPlace, place);
    return this.openAt(rung, parent, key, input);
  }

  private openAt(rung: AnyRung, parent: Scope, key: string, input: object): OpenScope {
    const byPlace = this.open.get(rung.name) as Map<string, OpenScope>;
    const place = placeOf(parent === this.app ? undefined : parent.name, rung.name, key);
    const existing = byPlace.get(place);
    if (existing) return existing;
    const { scope, ready } = this.graph.openRung(parent, rung, input, this.started, (gone) => {
      if (!this.app.closed && this.graph.has(Handoff, this.app)) this.graph.resolve(Handoff, this.app).closed(gone);
    });
    let retire: (closing: Promise<void>) => void = () => undefined;
    const retired = new Promise<void>((resolve) => {
      retire = resolve;
    });
    if (byPlace.size === 0) retire(this.retirement.get(rung.name) ?? Promise.resolve());
    const opened: OpenScope = { key, scope, ready, left: false, holders: 0, retired, retire };
    byPlace.set(place, opened);
    scope.defer(() => {
      if (byPlace.get(place) === opened) byPlace.delete(place);
    });
    void this.observe(ready);
    return opened;
  }

  private leaving(rung: string, byPlace: Map<string, OpenScope>, staying: string | undefined): void {
    let announce = false;
    for (const [place, open] of byPlace) {
      if (place === staying || open.left || open.holders > 0) continue;
      open.left = true;
      announce = true;
    }
    if (announce) this.graph.resolve(Handoff, this.app).leave(rung);
  }

  private current(): Set<OpenScope> {
    return new Set(this.chain());
  }

  private chain(): OpenScope[] {
    const standing = new Map<string, OpenScope>();
    for (const rung of this.ladder) {
      const parent = rung.under === undefined ? this.app : standing.get(rung.under.name)?.scope;
      if (!parent) continue;
      const current = this.ensureUnder(rung, parent);
      if (current) standing.set(rung.name, current);
      else this.closedUnder(rung);
    }
    return [...standing.values()];
  }

  private openScopes(): OpenScope[] {
    return [...this.open.values()].flatMap((byPlace) => [...byPlace.values()]);
  }

  private scopeFor(key: AnyKeyClass, from?: Scope): Scope {
    if (key.tier === 'app') return this.app;
    const rung = this.graph.rungOf(key.tier);
    if (!rung) throw new UnknownRungError(key.tier);
    if (from) {
      const owner = this.inChain(key.tier, rung, from);
      if (!owner) throw new TierMismatchError(key.id, key.tier, from);
      return owner;
    }
    const open = this.ensure(rung);
    if (!open) throw new RungClosedError(key.id, key.tier, rung.name);
    return open.scope;
  }

  private hostOf(key: AnyKeyClass, from?: Scope): Scope | undefined {
    if (key.tier === 'app') return this.app;
    const rung = this.graph.rungOf(key.tier);
    if (!rung) return undefined;
    if (from) return this.inChain(key.tier, rung, from);
    return this.ensure(rung)?.scope;
  }

  private focused(tier: Tier, rung: AnyRung): Scope | undefined {
    const open = this.ensure(rung);
    return open?.scope.hosts(tier) ? open.scope : undefined;
  }

  private inChain(tier: Tier, rung: AnyRung, from: Scope): Scope | undefined {
    const owner = from.owner(tier);
    if (owner) return owner;
    const focused = this.focused(tier, rung);
    if (!focused) return undefined;
    return from.isAncestorOf(focused) || this.beside(focused, from) ? focused : undefined;
  }

  private beside(focused: Scope, from: Scope): boolean {
    for (let at: Scope | undefined = from; at; at = at.parent) {
      if (at.parent === focused.parent) return at.tier !== undefined && at.tier !== focused.tier;
    }
    return false;
  }

  private standingKind(rung: AnyRung, tier: Tier): string | undefined {
    const open = this.ensure(rung);
    return open && !open.scope.hosts(tier) ? (open.scope.kind ?? open.scope.tier) : undefined;
  }

  private observe(ready: Promise<void>): Promise<void> {
    return ready.catch((error: unknown) => {
      if (error instanceof ScopeAbort) return;
      this.fail(error);
    });
  }

  private fail(error: unknown): void {
    if (this.app.closed || !this.graph.has(Failure, this.app)) {
      queueMicrotask(() => {
        throw error;
      });
      return;
    }
    this.failure.report(error);
  }

  adopt(): Promise<void> {
    const current = this.current();
    const closing = new Map<string, Promise<void>[]>();
    for (const [rung, byPlace] of this.open) {
      for (const [place, open] of byPlace) {
        if (current.has(open) || open.holders > 0) continue;
        byPlace.delete(place);
        closing.set(rung, [...(closing.get(rung) ?? []), open.scope.close()]);
      }
    }
    const all: Promise<void>[] = [];
    for (const [rung, byPlace] of this.open) {
      const retired = Promise.all([this.retirement.get(rung) ?? Promise.resolve(), ...(closing.get(rung) ?? [])]).then(() => undefined);
      this.retirement.set(rung, retired);
      for (const open of byPlace.values()) open.retire(retired);
      all.push(retired);
    }
    return Promise.all(all).then(() => undefined);
  }

  report(): AppReport {
    const scopes = [this.app, ...this.openScopes().map((open) => open.scope)];
    return {
      scopes: scopes.map((scope) => {
        const requires = this.graph.requiresOf(scope);
        return {
          name: scope.name,
          tier: scope.tier ?? '',
          kind: scope.kind,
          built: [...scope.instances.keys()].map((key) => ({ id: key.id, requires: [...(requires.get(key.id) ?? [])] })),
        };
      }),
    };
  }

  close(): Promise<void> {
    const closing = this.openScopes().map((open) => open.scope.close());
    for (const byPlace of this.open.values()) byPlace.clear();
    return Promise.all([...closing, this.app.close()]).then(() => undefined);
  }
}

export const App = {
  define<M extends LayerLike, const L extends readonly AnyRung[] = readonly []>(
    manifest: M,
    options: AppOptions<L> = {},
  ): Definition<M, L> {
    const ladder = (options.ladder ?? []) as L;
    distinctNames(ladder);
    parentsFirst(ladder);
    const merged = Layer.mergeAll(manifest, ...ladder.map((rung) => rung.own())) as AnyLayer;
    const tiers = new Set<string>(['app', ...ladder.flatMap((rung) => [rung.name, ...rung.kinds])]);
    for (const item of merged.items) {
      if ('key' in item && !tiers.has(item.key.tier)) {
        throw new UnknownTierError(
          item.key.id,
          item.key.tier,
          [...tiers].filter((tier) => tier !== 'app'),
        );
      }
    }
    return { manifest: merged, ladder, data: options.data };
  },
} as const;
