import type { Cell } from '@runlith/roster/cell';

import { nameFacts, type GraphUse } from './condition.js';
import { hasRecipe, isDeferredKey, optionalOf, type AnyKeyClass, type Deferred, type KeyClass, type Tier } from './key.js';
import type { AnyLayer, EntryItem, LayerItem, LayerLoader } from './Layer.js';
import { placeOf, type AnyRung } from './Rung.js';
import { Scope, ScopeAbort } from './Scope.js';

export type DataBuild = 'eager' | 'lazy';

export type Answer = (key: AnyKeyClass, scope: Scope) => unknown;

export interface Answers {
  readonly answer: Answer;
  readonly find: Answer;
}

export interface GraphOptions {
  readonly effectRoot: (build: () => void) => () => void;
  readonly watch?: (read: () => boolean, initial: boolean, react: (value: boolean) => void) => () => void;
  readonly cell?: <T>() => Cell<T>;
  readonly data?: DataBuild;
  readonly ladder?: readonly AnyRung[];
  readonly report?: (error: unknown) => void;
}

type Definition = Exclude<LayerItem, { kind: 'when' } | { kind: 'entry' }>;

type WhenItem = Extract<LayerItem, { kind: 'when' }>;

interface Admission {
  readonly keys: readonly AnyKeyClass[];
  readonly nested: readonly WhenItem[];
}

interface Staged {
  readonly admitted: readonly { readonly definition: Definition; readonly owner: Scope }[];
  readonly nested: readonly WhenItem[];
  readonly bound: boolean;
}

interface Reading {
  readonly bound: boolean;
  stop: () => void;
}

export class KeyIdCollisionError extends Error {
  constructor(readonly id: string) {
    super(`Two different keys are named "${id}" in one manifest: an id names one key, so rename one of them`);
    this.name = 'KeyIdCollisionError';
  }
}

export class DuplicateProviderError extends Error {
  constructor(
    readonly id: string,
    reason?: string,
  ) {
    super(reason === undefined ? `Service "${id}" is provided twice in the manifest` : `Service "${id}" is provided twice: ${reason}`);
  }
}

const LATE_REPLACEMENT =
  'its fallback already stands, and a replacement admitted later — under a condition, from a chunk or an entry — would swap it under its readers; list the replacement in the manifest itself';

function isFallback(definition: Definition): boolean {
  return definition.kind === 'make' && definition.fallback === true;
}

function standing(existing: Definition, arriving: Definition): Definition {
  if (isFallback(existing) === isFallback(arriving)) throw new DuplicateProviderError(arriving.key.id);
  return isFallback(existing) ? arriving : existing;
}

export class DependencyCycleError extends Error {
  constructor(readonly path: readonly string[]) {
    super(`Dependency cycle: ${path.join(' → ')}`);
  }
}

export class TierMismatchError extends Error {
  constructor(
    readonly id: string,
    readonly tier: Tier,
    readonly scope: Scope,
  ) {
    super(`Service "${id}" is ${tier}-tier; scope "${scope.name}" (${scope.tier ?? 'no tier'}) cannot build it`);
  }
}

export class UnknownTierError extends Error {
  constructor(
    readonly id: string,
    readonly tier: string,
    readonly ladder: readonly string[],
  ) {
    super(`Service "${id}" is ${tier}-tier, and the ladder names no such rung or kind (${ladder.join(', ') || 'app alone'})`);
  }
}

export class LayerTierError extends Error {
  constructor(
    readonly id: string,
    readonly tier: Tier,
    readonly reason: string,
  ) {
    super(`Service "${id}" is ${tier}-tier: ${reason}`);
  }
}

export class UnknownServiceError extends Error {
  constructor(
    readonly id: string,
    readonly unentered: readonly string[] = [],
  ) {
    super(
      unentered.length === 0
        ? `Service "${id}" is not in the manifest`
        : `Service "${id}" is not in the manifest or in an entry passed so far; not entered yet: ${unentered.join(', ')}`,
    );
  }
}

export class UnknownEntryError extends Error {
  constructor(readonly id: string) {
    super(`Entry "${id}" is not in the manifest: list it before a door opens it`);
    this.name = 'UnknownEntryError';
  }
}

export class MissingRecipeError extends Error {
  constructor(readonly id: string) {
    super(`Service "${id}" is in the manifest but declares no static make(): provide it with Layer.of or Layer.load, or give it a recipe`);
  }
}

export class ServiceStartError extends Error {
  constructor(
    readonly id: string,
    readonly scope: string,
    cause: unknown,
  ) {
    super(`Service "${id}" could not be built as scope "${scope}" started`, { cause });
    this.name = 'ServiceStartError';
  }
}

export class DeferredServiceError extends Error {
  constructor(readonly id: string) {
    super(`Service "${id}" is deferred: its code arrives with \`await ${id}.use()\`, nothing synchronous can reach it`);
  }
}

export function isGenerator<Self>(value: Generator<unknown, Self, unknown> | Self): value is Generator<unknown, Self, unknown> {
  return typeof value === 'object' && value !== null && Symbol.iterator in value && 'next' in value;
}

function chunkOf(definition: Definition): LayerLoader | undefined {
  return definition.kind === 'deferred' ? definition.load : undefined;
}

function readsBelow(item: WhenItem, admittedAt: Scope, scope: Scope, bound: boolean): boolean {
  return scope === admittedAt || !bound || item.tiers.length > 0;
}

function askedAt(scope: Scope, tiers: readonly Tier[]): boolean {
  if (tiers.length === 0) return true;
  return tiers.every((tier) => scope.owner(tier) !== undefined) && tiers.some((tier) => scope.hosts(tier));
}

export class Graph {
  readonly definitions = new Map<AnyKeyClass, Definition>();
  private readonly ids = new Map<string, AnyKeyClass>();
  readonly conditional: WhenItem[] = [];
  readonly data: DataBuild;
  readonly ladder: readonly AnyRung[];
  private readonly effectRoot: GraphOptions['effectRoot'];
  private readonly watch: GraphOptions['watch'];
  readonly cell: <T>() => Cell<T>;
  readonly report: (error: unknown) => void;
  private readonly tiers = new Set<string>(['app']);
  private readonly rungOfKind = new Map<string, string>();
  private readonly handles = new WeakMap<Scope, Map<AnyKeyClass, Deferred<unknown>>>();
  private readonly included = new WeakMap<Scope, Map<WhenItem, Admission>>();
  private readonly permanent = new WeakMap<Scope, WhenItem[]>();
  private readonly holders = new WeakMap<Scope, Map<AnyKeyClass, Set<WhenItem>>>();
  private readonly admitting = new WeakMap<Scope, Map<WhenItem, Promise<void>>>();
  private readonly lives = new WeakMap<Scope, Map<AnyKeyClass, { readonly life: Scope; readonly birth: number }>>();
  private births = 0;
  private readonly local = new WeakMap<Scope, Map<AnyKeyClass, Definition>>();
  private readonly chunks = new Map<LayerItem, Promise<AnyLayer>>();
  private readonly loaded = new Map<LayerItem, AnyLayer>();
  private readonly started = new Set<Scope>();
  private readonly conditioned = new WeakMap<Scope, Map<WhenItem, Reading>>();
  private readonly requires = new WeakMap<Scope, Map<string, Set<string>>>();
  private readonly lasting = new WeakMap<Scope, Definition[]>();
  private readonly entries = new Set<EntryItem>();
  private readonly entered = new Map<EntryItem, { readonly staged: Staged; started: boolean }>();
  private readonly answers: Answers = {
    answer: (key, at) => this.answer(key, at),
    find: (key, at) => (this.present(key, at) ? this.answer(key, at) : undefined),
  };

  constructor(layer: AnyLayer, options: GraphOptions) {
    this.effectRoot = options.effectRoot;
    this.watch = options.watch;
    this.cell = options.cell ?? (<T>(): Cell<T> => ({ current: undefined }));
    this.report =
      options.report ??
      ((error) => {
        queueMicrotask(() => {
          throw error;
        });
      });
    this.data = options.data ?? 'eager';
    this.ladder = options.ladder ?? [];
    for (const rung of this.ladder) {
      this.tiers.add(rung.name);
      for (const kind of rung.kinds) {
        this.tiers.add(kind);
        this.rungOfKind.set(kind, rung.name);
      }
    }
    this.register(layer, this.definitions, this.conditional);
  }

  has(key: AnyKeyClass, scope: Scope): boolean {
    return this.lookup(key, scope) !== undefined;
  }

  present(key: AnyKeyClass, scope: Scope): boolean {
    const owner = scope.owner(key.tier);
    return owner !== undefined && !owner.closed && this.lookup(key, owner) !== undefined;
  }

  resolve<Self>(key: KeyClass<string, Self>, scope: Scope): Self {
    const owner = this.scopeFor(key, scope);
    owner.assertOpen();
    const existing = owner.instances.get(key);
    if (existing) return existing as Self;

    const definition = this.lookup(key, owner);
    if (!definition) throw new UnknownServiceError(key.id, this.unentered());
    if (definition.kind === 'value') {
      owner.instances.set(key, definition.instance);
      return definition.instance as Self;
    }
    if (definition.kind === 'deferred') throw new DeferredServiceError(key.id);

    return this.construct(key, owner, definition.kind === 'make' ? definition.make : () => definition.key.make());
  }

  resolveDeferred<Self>(key: KeyClass<string, Self>, scope: Scope): Promise<Self> {
    const owner = this.scopeFor(key, scope);
    owner.assertOpen();
    const existing = owner.instances.get(key);
    if (existing) return Promise.resolve(existing as Self);

    const definition = this.lookup(key, owner);
    if (!definition) return Promise.reject(new UnknownServiceError(key.id, this.unentered()));
    const loader = chunkOf(definition);
    if (!loader) return Promise.resolve(this.resolve(key, scope));

    let chunk = this.chunks.get(definition);
    if (!chunk) {
      chunk = loader().then((module) => module.default as AnyLayer);
      this.chunks.set(definition, chunk);
      chunk.catch(() => this.chunks.delete(definition));
    }
    return owner.await(chunk).then((layer) => {
      const built = owner.instances.get(key);
      if (built) return built as Self;
      this.include(layer, owner);
      return this.resolve(key, owner);
    });
  }

  resolveHandle<Self>(key: KeyClass<string, Self>, scope: Scope): Deferred<Self> {
    const owner = this.scopeFor(key, scope);
    owner.assertOpen();
    let byKey = this.handles.get(owner);
    if (!byKey) {
      byKey = new Map();
      this.handles.set(owner, byKey);
    }
    const existing = byKey.get(key);
    if (existing) return existing as Deferred<Self>;

    const definition = this.lookup(key, owner);
    if (!definition) throw new UnknownServiceError(key.id, this.unentered());
    const cell = this.cell<Self>();
    if (!chunkOf(definition)) cell.current = this.resolve(key, owner);
    const ready =
      cell.current !== undefined
        ? Promise.resolve(cell.current)
        : this.resolveDeferred(key, owner).then((instance) => {
            cell.current = instance;
            return instance;
          });
    ready.catch(() => undefined);
    const handle: Deferred<Self> = {
      get current() {
        return cell.current;
      },
      ready,
      then: (onFulfilled, onRejected) => ready.then(onFulfilled, onRejected),
    };
    byKey.set(key, handle);
    return handle;
  }

  answer(key: AnyKeyClass, scope: Scope): unknown {
    return isDeferredKey(key) ? this.resolveHandle(key, scope) : this.resolve(key, scope);
  }

  rungOf(tier: Tier): AnyRung | undefined {
    const name = this.rungOfKind.get(tier) ?? tier;
    return this.ladder.find((rung) => rung.name === name);
  }

  requiresOf(scope: Scope): ReadonlyMap<string, ReadonlySet<string>> {
    return this.requires.get(scope) ?? new Map();
  }

  private construct<Self>(key: KeyClass<string, Self>, owner: Scope, recipe: () => unknown): Self {
    if (owner.building.has(key)) throw new DependencyCycleError([...owner.building, key].map((k) => k.id));
    owner.building.add(key);
    try {
      const instance = this.build(key, owner, recipe);
      owner.instances.set(key, instance as object);
      return instance;
    } finally {
      owner.building.delete(key);
    }
  }

  spawn<Self>(life: Scope, id: string, recipe: () => unknown, answers?: Answers): Self {
    life.assertOpen();
    return this.live(life, id, recipe, 'Process', answers);
  }

  private live<Self>(life: Scope, id: string, recipe: () => unknown, kind: 'Service' | 'Process', answers?: Answers): Self {
    let instance: Self | undefined;
    let failure: unknown;
    const teardown = this.effectRoot(() => {
      try {
        instance = this.run(life, recipe, id, answers);
      } catch (error) {
        failure = error;
      }
    });
    if (failure !== undefined || instance === undefined) {
      teardown();
      void life.close();
      throw failure ?? new Error(`${kind} "${id}" make() returned nothing`);
    }
    if (typeof instance === 'object' && instance !== null) nameFacts(id, instance);
    life.defer(teardown);
    return instance;
  }

  open(scope: Scope, provide: readonly Definition[] = [], start = true): Promise<void> {
    try {
      scope.graph = this;
      const local = new Map<AnyKeyClass, Definition>();
      this.local.set(scope, local);
      for (const definition of provide) local.set(definition.key, definition);
      return start ? this.start(scope) : Promise.resolve();
    } catch (error) {
      void scope.close();
      throw error;
    }
  }

  openRung(
    parent: Scope,
    rung: AnyRung,
    input: object,
    start = true,
    closed?: (scope: Scope) => void,
  ): { scope: Scope; ready: Promise<void> } {
    const place = placeOf(parent.parent === undefined ? undefined : parent.name, rung.name, rung.keyOf(input));
    const scope = parent.rung(place, rung.name as Tier, rung.kindOf(input) as Tier | undefined);
    if (closed) scope.defer(() => closed(scope));
    return { scope, ready: this.open(scope, [{ kind: 'value', key: rung.Current, instance: input }], start) };
  }

  start(scope: Scope): Promise<void> {
    if (this.started.has(scope)) return Promise.resolve();
    this.started.add(scope);
    scope.defer(() => void this.started.delete(scope));
    try {
      const pending: Promise<void>[] = [];
      for (const item of this.conditional) this.startCondition(item, scope, pending);
      for (let at: Scope | undefined = scope; at; at = at.parent) {
        for (const item of this.permanent.get(at) ?? []) this.startCondition(item, scope, pending);
        for (const [source, { nested }] of this.included.get(at) ?? []) {
          const bound = this.boundOf(source, at);
          for (const item of nested) if (readsBelow(item, at, scope, bound)) this.startCondition(item, scope, pending, bound);
        }
      }
      const inherited: Definition[] = [];
      for (let at = scope.parent; at; at = at.parent) inherited.push(...(this.lasting.get(at) ?? []));
      this.wake(scope, [...this.definitions.values(), ...(this.local.get(scope)?.values() ?? []), ...inherited]);
      return pending.length > 0 ? Promise.all(pending).then(() => undefined) : Promise.resolve();
    } catch (error) {
      void scope.close();
      throw error;
    }
  }

  private startCondition(item: WhenItem, scope: Scope, pending: Promise<void>[], outerBound = false): void {
    if (!askedAt(scope, item.tiers)) return;
    let read = this.conditioned.get(scope);
    if (!read) {
      read = new Map();
      this.conditioned.set(scope, read);
    }
    if (read.has(item)) return;
    const reading: Reading = { bound: outerBound || item.tiers.length > 0, stop: () => undefined };
    read.set(item, reading);
    const graph = this.boundTo(scope);
    const initial = item.read(graph);
    if (initial) {
      const admitted = this.enable(item, scope);
      if (admitted) pending.push(admitted);
    }
    if (this.watch) {
      const unwatch = this.watch(
        () => item.read(graph),
        initial,
        (on) => {
          if (!on) {
            this.disable(item, scope);
            return;
          }
          this.enable(item, scope)?.catch((error: unknown) => this.report(error));
        },
      );
      scope.defer(unwatch);
      reading.stop = () => {
        scope.release(unwatch);
        unwatch();
      };
    }
  }

  private stopCondition(item: WhenItem, scope: Scope): void {
    const reading = this.conditioned.get(scope)?.get(item);
    if (!reading) return;
    this.conditioned.get(scope)?.delete(item);
    reading.stop();
    this.disable(item, scope);
  }

  private brought(item: WhenItem, scope: Scope): boolean {
    if (this.conditional.includes(item)) return true;
    for (let at: Scope | undefined = scope; at; at = at.parent) {
      if (this.permanent.get(at)?.includes(item)) return true;
      for (const { nested } of this.included.get(at)?.values() ?? []) if (nested.includes(item)) return true;
    }
    return false;
  }

  private boundOf(source: WhenItem, scope: Scope): boolean {
    return this.conditioned.get(scope)?.get(source)?.bound ?? source.tiers.length > 0;
  }

  private under(scope: Scope): Scope[] {
    return [...this.started].filter((running) => running === scope || scope.isAncestorOf(running));
  }

  prefetch(parent: Scope, rung: AnyRung, input: object): Promise<void> {
    const kind = rung.kindOf(input);
    const hosts = (tier: Tier): boolean => tier === rung.name || tier === kind;
    const asked = (tiers: readonly Tier[]): boolean =>
      tiers.length > 0 && tiers.every((tier) => hosts(tier) || parent.owner(tier) !== undefined) && tiers.some(hosts);
    const brought: LayerItem[] = [...this.conditional];
    for (let at: Scope | undefined = parent; at; at = at.parent) {
      brought.push(...(this.permanent.get(at) ?? []));
      for (const { nested } of this.included.get(at)?.values() ?? []) brought.push(...nested);
    }
    return this.fetchAsked(brought, asked);
  }

  private fetchAsked(items: readonly LayerItem[], asked: (tiers: readonly Tier[]) => boolean): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const item of items) {
      if (item.kind !== 'when' || !asked(item.tiers)) continue;
      if (typeof item.layer !== 'function') {
        pending.push(this.fetchAsked(item.layer.items, asked));
        continue;
      }
      const landed = this.loaded.get(item);
      pending.push(
        landed ? this.fetchAsked(landed.items, asked) : this.chunk(item, item.layer).then((layer) => this.fetchAsked(layer.items, asked)),
      );
    }
    return Promise.all(pending).then(() => undefined);
  }

  prepareEntry(entry: EntryItem, scope: Scope): Promise<void> {
    if (!this.entries.has(entry)) return Promise.reject(new UnknownEntryError(entry.id));
    const app = this.appOf(scope);
    const landed = this.loaded.get(entry);
    return app.await(landed ? Promise.resolve(landed) : this.chunk(entry, entry.load)).then((layer) => {
      const running = this.under(app);
      return app.await(this.fetchAsked(layer.items, (tiers) => tiers.length > 0 && running.some((open) => askedAt(open, tiers))));
    });
  }

  registerEntry(entry: EntryItem, scope: Scope): void {
    if (this.entered.has(entry)) return;
    if (!this.entries.has(entry)) throw new UnknownEntryError(entry.id);
    const layer = this.loaded.get(entry);
    if (!layer) throw new Error(`Entry "${entry.id}" is registered before its chunk landed: prepare it first`);
    const app = this.appOf(scope);
    app.assertOpen();
    this.entered.set(entry, { staged: this.admit(layer, app) as Staged, started: false });
  }

  startEntry(entry: EntryItem, scope: Scope): void {
    this.registerEntry(entry, scope);
    const entered = this.entered.get(entry) as { readonly staged: Staged; started: boolean };
    if (entered.started) return;
    entered.started = true;
    this.activate(entered.staged, this.appOf(scope))?.catch((error: unknown) => this.report(error));
  }

  private unentered(): string[] {
    return [...this.entries].filter((entry) => !this.entered.has(entry)).map((entry) => entry.id);
  }

  private appOf(scope: Scope): Scope {
    return scope.owner('app') ?? scope;
  }

  private enable(item: WhenItem, scope: Scope): Promise<void> | undefined {
    if (this.included.get(scope)?.has(item)) return undefined;
    const loader = item.layer;
    if (typeof loader !== 'function') return this.include(loader, scope, item);
    const landed = this.loaded.get(item);
    if (landed) return this.include(landed, scope, item);

    let flying = this.admitting.get(scope);
    if (!flying) {
      flying = new Map();
      this.admitting.set(scope, flying);
    }
    if (flying.has(item)) return undefined;
    const attempt = scope
      .await(this.chunk(item, loader))
      .then((layer) => {
        flying.delete(item);
        if (!this.conditioned.get(scope)?.has(item)) return undefined;
        if (item.read(this.boundTo(scope))) return this.include(layer, scope, item);
        return undefined;
      })
      .catch((error: unknown) => {
        flying.delete(item);
        if (error instanceof ScopeAbort) return;
        throw error;
      });
    flying.set(item, attempt);
    return attempt;
  }

  private disable(item: WhenItem, scope: Scope): void {
    const admission = this.included.get(scope)?.get(item);
    if (!admission) return;
    this.included.get(scope)?.delete(item);

    for (const running of this.under(scope)) {
      for (const nested of admission.nested) if (!this.brought(nested, running)) this.stopCondition(nested, running);
    }

    const ending: { readonly life: Scope; readonly birth: number }[] = [];
    for (const key of admission.keys) {
      const owner = this.ownerScope(key, scope);
      const holds = this.holders.get(owner)?.get(key);
      if (!holds?.delete(item) || holds.size > 0) continue;
      this.holders.get(owner)?.delete(key);
      const lived = this.lives.get(owner)?.get(key);
      if (lived) ending.push(lived);
      owner.instances.delete(key);
      this.local.get(owner)?.delete(key);
    }
    for (const { life } of ending.sort((a, b) => b.birth - a.birth)) void life.close();
  }

  private boundTo(scope: Scope): GraphUse {
    return { get: (key) => this.resolve(key, scope) };
  }

  private chunk(item: LayerItem, loader: LayerLoader): Promise<AnyLayer> {
    const inFlight = this.chunks.get(item);
    if (inFlight) return inFlight;
    const chunk = loader().then((module) => {
      this.loaded.set(item, module.default);
      return module.default;
    });
    this.chunks.set(item, chunk);
    chunk.catch(() => this.chunks.delete(item));
    return chunk;
  }

  private include(layer: AnyLayer, scope: Scope, source?: WhenItem): Promise<void> | undefined {
    const staged = this.admit(layer, scope, source);
    return staged && this.activate(staged, scope, source);
  }

  private admit(layer: AnyLayer, scope: Scope, source?: WhenItem): Staged | undefined {
    if (source && this.included.get(scope)?.has(source)) return undefined;
    const bound = source !== undefined && this.boundOf(source, scope);
    const admitted: { definition: Definition; owner: Scope; into: Map<AnyKeyClass, Definition> }[] = [];
    const reused: { key: AnyKeyClass; owner: Scope }[] = [];
    const seen = new Map<AnyKeyClass, Definition>();
    const nested: WhenItem[] = [];
    for (const item of layer.items) {
      if (item.kind === 'when') {
        this.admitCondition(item);
        if (!nested.includes(item)) nested.push(item);
        continue;
      }
      if (item.kind === 'entry') throw new Error(`Entry "${item.id}" stands inside a chunk: an entry is listed by the manifest itself`);
      this.admitTier(item.key);
      const owner = this.ownerScope(item.key, scope);
      if (bound && owner !== scope && owner.isAncestorOf(scope)) {
        throw new LayerTierError(
          item.key.id,
          item.key.tier,
          `admitted at "${scope.name}" it would be filed at "${owner.name}" and outlive the condition that admitted it`,
        );
      }
      let into = this.local.get(owner);
      if (!into) {
        into = new Map();
        this.local.set(owner, into);
      }
      const existing = seen.get(item.key) ?? into.get(item.key) ?? this.definitions.get(item.key);
      if (existing === item) {
        if (source && !seen.has(item.key) && into.get(item.key) === item) reused.push({ key: item.key, owner });
        continue;
      }
      const replaced = existing !== undefined && seen.get(item.key) === existing && isFallback(existing);
      if (existing && !chunkOf(existing)) {
        if (!seen.has(item.key)) {
          if (isFallback(item) && !isFallback(existing)) continue;
          throw new DuplicateProviderError(item.key.id, isFallback(existing) && !isFallback(item) ? LATE_REPLACEMENT : undefined);
        }
        if (standing(existing, item) === existing) continue;
      }
      if (item.kind === 'key' && !hasRecipe(item.key)) throw new MissingRecipeError(item.key.id);
      this.assertOwnId(item.key);
      seen.set(item.key, item);
      const entry = { definition: item, owner, into };
      if (replaced)
        admitted.splice(
          admitted.findIndex((one) => one.definition === existing),
          1,
          entry,
        );
      else admitted.push(entry);
    }
    for (const { definition, into } of admitted) {
      into.set(definition.key, definition);
      this.ids.set(definition.key.id, definition.key);
    }
    if (source) {
      let bySource = this.included.get(scope);
      if (!bySource) {
        bySource = new Map();
        this.included.set(scope, bySource);
      }
      const held: AnyKeyClass[] = [];
      for (const { definition, owner } of admitted) {
        this.holdersOf(owner).set(definition.key, new Set([source]));
        held.push(definition.key);
      }
      for (const { key, owner } of reused) {
        const holds = this.holdersOf(owner).get(key);
        if (!holds) continue;
        holds.add(source);
        held.push(key);
      }
      bySource.set(source, { keys: held, nested });
    }
    return { admitted, nested, bound };
  }

  private activate({ admitted, nested, bound }: Staged, scope: Scope, source?: WhenItem): Promise<void> | undefined {
    if (!source) {
      if (nested.length > 0) {
        let permanent = this.permanent.get(scope);
        if (!permanent) {
          permanent = [];
          this.permanent.set(scope, permanent);
        }
        for (const item of nested) if (!permanent.includes(item)) permanent.push(item);
      }
      for (const { definition, owner } of admitted) {
        let lasting = this.lasting.get(owner);
        if (!lasting) {
          lasting = [];
          this.lasting.set(owner, lasting);
        }
        lasting.push(definition);
      }
    }
    for (const { definition, owner } of admitted) {
      if (definition.kind === 'value' || chunkOf(definition)) continue;
      if (this.data !== 'eager' && !definition.key.eager) continue;
      for (const running of source ? [owner] : this.under(owner)) {
        if (running.hosts(definition.key.tier) && this.started.has(running)) this.wakeOne(definition.key, running);
      }
    }
    if (nested.length === 0) return undefined;
    const pending: Promise<void>[] = [];
    for (const running of this.under(scope)) {
      for (const item of nested) if (readsBelow(item, scope, running, bound)) this.startCondition(item, running, pending, bound);
    }
    return pending.length > 0 ? Promise.all(pending).then(() => undefined) : undefined;
  }

  private register(layer: AnyLayer, into: Map<AnyKeyClass, Definition>, conditional: WhenItem[]): void {
    for (const item of layer.items) {
      if (item.kind === 'when') {
        this.admitCondition(item);
        if (!conditional.includes(item)) conditional.push(item);
        continue;
      }
      if (item.kind === 'entry') {
        this.entries.add(item);
        continue;
      }
      this.admitTier(item.key);
      const existing = into.get(item.key) ?? this.definitions.get(item.key);
      if (existing === item) continue;
      if (existing && standing(existing, item) === existing) continue;
      if (item.kind === 'key' && !hasRecipe(item.key)) throw new MissingRecipeError(item.key.id);
      this.assertOwnId(item.key);
      into.set(item.key, item);
      this.ids.set(item.key.id, item.key);
    }
  }

  private assertOwnId(key: AnyKeyClass): void {
    const holder = this.ids.get(key.id);
    if (holder && holder !== key) throw new KeyIdCollisionError(key.id);
  }

  private admitTier(key: AnyKeyClass): void {
    if (!this.tiers.has(key.tier))
      throw new UnknownTierError(
        key.id,
        key.tier,
        [...this.tiers].filter((tier) => tier !== 'app'),
      );
  }

  private admitCondition(item: WhenItem): void {
    const kinds = new Map<string, Tier>();
    for (const tier of item.tiers) {
      if (!this.tiers.has(tier))
        throw new UnknownTierError(
          'a condition',
          tier,
          [...this.tiers].filter((t) => t !== 'app'),
        );
      const rung = this.rungOfKind.get(tier);
      if (rung === undefined) continue;
      const other = kinds.get(rung);
      if (other !== undefined && other !== tier) {
        throw new LayerTierError('a condition', tier, `it reads a ${other}-tier key too, and no scope of "${rung}" is both`);
      }
      kinds.set(rung, tier);
    }
  }

  private lookup(key: AnyKeyClass, scope: Scope): Definition | undefined {
    for (let current: Scope | undefined = scope; current; current = current.parent) {
      const local = this.local.get(current)?.get(key);
      if (local) return local;
    }
    return this.definitions.get(key);
  }

  private holdersOf(owner: Scope): Map<AnyKeyClass, Set<WhenItem>> {
    let byKey = this.holders.get(owner);
    if (!byKey) {
      byKey = new Map();
      this.holders.set(owner, byKey);
    }
    return byKey;
  }

  private ownerScope(key: AnyKeyClass, scope: Scope): Scope {
    return scope.owner(key.tier) ?? scope;
  }

  private scopeFor(key: AnyKeyClass, scope: Scope): Scope {
    const owner = scope.owner(key.tier);
    if (!owner) throw new TierMismatchError(key.id, key.tier, scope);
    return owner;
  }

  private build<Self>(key: KeyClass<string, Self>, owner: Scope, recipe: () => unknown): Self {
    const life = owner.child(key.id);
    const instance = this.live<Self>(life, key.id, recipe, 'Service');
    let byKey = this.lives.get(owner);
    if (!byKey) {
      byKey = new Map();
      this.lives.set(owner, byKey);
    }
    const lives = byKey;
    lives.set(key, { life, birth: (this.births += 1) });
    life.defer(() => {
      if (lives.get(key)?.life === life) lives.delete(key);
    });
    return instance;
  }

  private run<Self>(scope: Scope, recipe: () => unknown, from: string, answers: Answers = this.answers): Self {
    const made = recipe() as Generator<unknown, Self, unknown> | Self;
    if (!isGenerator<Self>(made)) return made;
    let byBuilder = this.requires.get(scope.home);
    if (!byBuilder) {
      byBuilder = new Map();
      this.requires.set(scope.home, byBuilder);
    }
    const required = new Set<string>();
    byBuilder.set(from, required);
    let step = made.next();
    while (!step.done) {
      const requested: unknown = step.value;
      const optional = optionalOf(requested);
      let value: unknown;
      if (requested === Scope) {
        value = scope;
      } else if (optional) {
        required.add(optional.id);
        value = answers.find(optional, scope);
      } else {
        required.add((requested as AnyKeyClass).id);
        value = answers.answer(requested as AnyKeyClass, scope);
      }
      step = made.next(value);
    }
    return step.value;
  }

  private wake(scope: Scope, items: Iterable<Definition | LayerItem>): void {
    for (const item of items) {
      if (item.kind === 'value' || item.kind === 'when' || item.kind === 'entry' || chunkOf(item)) continue;
      if (!scope.hosts(item.key.tier)) continue;
      if (this.data === 'eager' || item.key.eager) this.wakeOne(item.key, scope);
    }
  }

  private wakeOne(key: AnyKeyClass, owner: Scope): void {
    try {
      this.resolve(key, owner);
    } catch (error) {
      if (owner.closed) return;
      this.report(new ServiceStartError(key.id, owner.name, error));
    }
  }
}
