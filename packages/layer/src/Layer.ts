import { isGenerator } from './Graph.js';
import {
  isKeyClass,
  type AnyDeferredKeyClass,
  type AnyKey,
  type AnyKeyClass,
  type Ask,
  type AnySelfMadeKeyClass,
  type InstanceOf,
  type Key,
  type KeyClass,
  type Provided,
  type ReachableFrom,
  type Requires,
  type SelfMadeKeyClass,
  type Tier,
  type TierViolation,
} from './key.js';
import { Scope, type ScopeKey } from './Scope.js';

declare const LayerTag: unique symbol;

export type LayerLoader = () => Promise<{ readonly default: AnyLayer }>;

type Loadable<L> = L | (() => Promise<{ readonly default: L }>);

export type Recipe = () => Generator<Ask, unknown, unknown> | unknown;

import type { Condition, GraphUse, Reader } from './condition.js';

type ValueOf<K> = K extends { readonly key: Key<string, infer S> } ? S : never;

type ValuesOf<Ks> = { -readonly [I in keyof Ks]: ValueOf<Ks[I]> };

function tiersOf(keys: readonly AnyKeyClass[]): readonly Tier[] {
  return [...new Set(keys.map((key) => key.tier).filter((tier) => tier !== 'app'))];
}

export type LayerItem =
  | { readonly kind: 'key'; readonly key: AnySelfMadeKeyClass }
  | { readonly kind: 'value'; readonly key: AnyKeyClass; readonly instance: object }
  | {
      readonly kind: 'make';
      readonly key: AnyKeyClass;
      readonly make: Recipe;
      readonly fallback?: true;
      readonly joins?: () => AnyKeyClass;
    }
  | { readonly kind: 'deferred'; readonly key: AnyKeyClass; readonly load: LayerLoader }
  | {
      readonly kind: 'when';
      readonly tiers: readonly Tier[];
      readonly read: (graph: GraphUse) => boolean;
      readonly layer: AnyLayer | LayerLoader;
    }
  | EntryItem;

export interface EntryItem {
  readonly kind: 'entry';
  readonly id: string;
  readonly load: LayerLoader;
}

declare const WhenTag: unique symbol;
declare const Unnamed: unique symbol;

export interface When<K extends AnyKey, C extends object> {
  readonly [WhenTag]: { key: K; under: C };
}

export type Named<N extends string> = { readonly [P in N]: true };

export interface UnnamedProvision {
  readonly [Unnamed]: never;
}

export interface UnnamedRequirement {
  readonly [Unnamed]: unknown;
}

type Under<X, C extends object> =
  X extends When<infer K extends AnyKey, infer C0 extends object> ? When<K, C0 & C> : X extends AnyKey ? When<X, C> : X;

export type Satisfying<O> = O | (O extends AnyKey ? When<O, object> : never);

type ProvisionUnder<C> = C extends Reader<infer N, AnyKey> ? (string extends N ? UnnamedProvision : Named<N>) : UnnamedProvision;

type RequirementUnder<C> = C extends Reader<infer N, AnyKey> ? (string extends N ? UnnamedRequirement : Named<N>) : UnnamedRequirement;

type ReadsOf<C> = C extends Reader<string, infer R> ? R : never;

export type Out = AnyKey | When<AnyKey, object>;

export type Want = Out | TierViolation<string, string>;

type Conditional<L, P extends object, R extends object, Reads> = Layer<
  Extract<Under<OutOf<L>, P>, Out>,
  Extract<Under<InOf<L>, R> | Reads, Want>
>;

export interface Layer<ROut extends Out, RIn extends Want> {
  readonly [LayerTag]: { out: ROut; in: RIn };
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-unused-vars -- the merge above IS how these parameters reach the type
export class Layer<ROut extends Out, RIn extends Want> {
  constructor(readonly items: readonly LayerItem[]) {}

  static mergeAll<const Ls extends readonly LayerLike[]>(
    ...layers: Ls
  ): Layer<OutOf<Ls[number]>, Exclude<InOf<Ls[number]>, Satisfying<OutOf<Ls[number]>> | ScopeKey>> {
    return new Layer(layers.flatMap((layer) => toLayer(layer).items));
  }

  static when<C extends Condition, L extends LayerLike>(
    condition: C,
    layer: Loadable<L>,
  ): Conditional<L, ProvisionUnder<C>, RequirementUnder<C>, ReadsOf<C>>;
  static when<K extends AnyKeyClass, L extends LayerLike>(
    key: K,
    holds: (value: ValueOf<K>) => boolean,
    layer: Loadable<L>,
  ): Conditional<L, UnnamedProvision, UnnamedRequirement, Provided<K>>;
  static when<const Ks extends readonly AnyKeyClass[], L extends LayerLike>(
    keys: Ks,
    holds: (...values: ValuesOf<Ks>) => boolean,
    layer: Loadable<L>,
  ): Conditional<L, UnnamedProvision, UnnamedRequirement, Provided<Ks[number]>>;
  static when(first: unknown, second: unknown, third?: unknown): AnyLayer {
    const layer = (third ?? second) as Loadable<LayerLike>;
    const resolved: AnyLayer | LayerLoader = isLoader(layer) ? async () => ({ default: toLayer((await layer()).default) }) : toLayer(layer);

    if (third !== undefined) {
      const keys = (Array.isArray(first) ? first : [first]) as readonly AnyKeyClass[];
      const holds = second as (...values: unknown[]) => boolean;
      const read = (graph: GraphUse) => holds(...keys.map((key) => graph.get(key as KeyClass<string, unknown>)));
      return new Layer([{ kind: 'when', tiers: tiersOf(keys), read, layer: resolved }]);
    }

    const condition = first as Condition;
    if (typeof condition === 'function') {
      return new Layer([{ kind: 'when', tiers: [], read: condition, layer: resolved }]);
    }
    const tiers = condition.tier === 'app' ? [] : [condition.tier];
    return new Layer([{ kind: 'when', tiers, read: (graph) => condition.read(graph), layer: resolved }]);
  }

  static of<K extends AnyKeyClass | AnyDeferredKeyClass>(key: K, instance: InstanceOfKey<K>): Layer<Provided<K>, never> {
    return new Layer([{ kind: 'value', key: key as AnyKeyClass, instance: instance as object }]);
  }

  static provide<K extends AnyKeyClass | AnyDeferredKeyClass, Y extends Ask = never>(
    key: K,
    make: () => Generator<Y, InstanceOfKey<K>, unknown> | InstanceOfKey<K>,
  ): Layer<Provided<K>, ReachableFrom<K, Extract<Y, AnyKey>>> {
    return new Layer([{ kind: 'make', key: key as AnyKeyClass, make: make as Recipe }]);
  }

  static fallback<K extends AnySelfMadeKeyClass>(key: K): Layer<Provided<K>, ReachableFrom<K, Requires<K>>>;
  static fallback<K extends AnyKeyClass | AnyDeferredKeyClass, Y extends Ask = never>(
    key: K,
    make: () => Generator<Y, InstanceOfKey<K>, unknown> | InstanceOfKey<K>,
  ): Layer<Provided<K>, ReachableFrom<K, Extract<Y, AnyKey>>>;
  static fallback(key: AnyKeyClass | AnyDeferredKeyClass, make?: Recipe): Layer<never, never> {
    const recipe = make ?? (() => (key as AnySelfMadeKeyClass).make());
    return new Layer<never, never>([{ kind: 'make', key: key as AnyKeyClass, make: recipe, fallback: true }]);
  }

  static member<O extends AnyKeyClass, M>(owner: () => O, join: (owner: InstanceOf<O>, member: M, key: AnyKeyClass) => () => void) {
    return <L extends MemberLayer<M>>(member: L): Layer<OutOf<L>, InOf<L> | ReachableFrom<OutOf<L>, Provided<O>>> => {
      const { key, make } = memberOf(member);
      const recipe = function* () {
        const host = (yield owner().key as unknown as Provided<O>) as InstanceOf<O>;
        const scope = yield* Scope;
        const made = make();
        const built = isGenerator<unknown>(made) ? yield* made : made;
        scope.defer(join(host, built as M, key));
        return built;
      };
      return new Layer([{ kind: 'make', key, make: recipe as Recipe, joins: owner }]) as unknown as Layer<
        OutOf<L>,
        InOf<L> | ReachableFrom<OutOf<L>, Provided<O>>
      >;
    };
  }

  static load<K extends AnyDeferredKeyClass, L extends AnyLayer>(
    key: K,
    loader: () => Promise<{ readonly default: L }>,
  ): Layer<Provided<K>, InOf<L>> {
    return new Layer([{ kind: 'deferred', key: key as unknown as AnyKeyClass, load: loader }]);
  }

  static entry<L extends AnyLayer>(id: string, loader: () => Promise<{ readonly default: L }>): Entry<OutOf<L>, InOf<L>> {
    return new Entry(id, loader);
  }
}

export class Entry<ROut extends Out = Out, RIn extends Want = Want> extends Layer<ROut, RIn> {
  constructor(id: string, load: LayerLoader) {
    super([{ kind: 'entry', id, load }]);
  }

  get item(): EntryItem {
    return this.items[0] as EntryItem;
  }

  get id(): string {
    return this.item.id;
  }

  prepare(scope: Scope): Promise<void> {
    return graphOf(scope).prepareEntry(this.item, scope);
  }

  register(scope: Scope): void {
    graphOf(scope).registerEntry(this.item, scope);
  }

  enter(scope: Scope): void {
    graphOf(scope).startEntry(this.item, scope);
  }
}

function graphOf(scope: Scope) {
  const graph = scope.graph;
  if (!graph) throw new Error('An entry needs a scope the graph opened');
  return graph;
}

export type AnyLayer = Layer<Out, Want>;
export type LayerLike = AnySelfMadeKeyClass | AnyLayer;

export type MemberLayer<M> = Layer<Key<string, M>, Want> | SelfMadeKeyClass<string, M>;

function memberOf(member: LayerLike): { key: AnyKeyClass; make: Recipe } {
  const items = toLayer(member).items;
  const item = items[0];
  if (items.length !== 1 || !item || (item.kind !== 'key' && item.kind !== 'make')) {
    throw new Error('A registry member is one key: a bare self-made class or a single Layer.provide');
  }
  return item.kind === 'key' ? { key: item.key, make: () => item.key.make() } : { key: item.key, make: item.make };
}

export type OutOf<L> = L extends Layer<infer O, Want> ? O : Provided<L>;
export type InOf<L> = L extends Layer<Out, infer I> ? I : ReachableFrom<L, Requires<L>>;

type InstanceOfKey<K> = K extends { readonly key: Key<string, infer S> } ? S : never;

function isLoader<L extends LayerLike>(
  layer: L | (() => Promise<{ readonly default: L }>),
): layer is () => Promise<{ readonly default: L }> {
  return typeof layer === 'function' && !isKeyClass(layer);
}

const keyItems = new WeakMap<AnyKeyClass, LayerItem>();

export function toLayer(layer: LayerLike): AnyLayer {
  if (!isKeyClass(layer)) return layer as AnyLayer;
  let item = keyItems.get(layer);
  if (!item) {
    item = { kind: 'key', key: layer };
    keyItems.set(layer, item);
  }
  return new Layer([item]);
}
