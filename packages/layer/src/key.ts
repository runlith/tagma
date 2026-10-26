import type { FindDoor, UseDoor } from './door.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the extension point is empty until an app fills it.
export interface Ladder {}

export interface Step {
  readonly kinds?: string;
  readonly under?: string;
  readonly always?: true;
}

type Rungs = keyof Ladder & string;

type KindsOf<R> = R extends Rungs ? (Ladder[R] extends { readonly kinds: infer K extends string } ? K : never) : never;

export type UnderOf<R> = R extends Rungs ? (Ladder[R] extends { readonly under: infer U extends string } ? U : 'app') : never;

export type Tier = 'app' | Rungs | KindsOf<Rungs>;

type Above<R, Seen = never> = R extends Rungs ? (R extends Seen ? never : UnderOf<R> | Above<UnderOf<R>, Seen | R>) : never;

type RungOfKind<T> = { [R in Rungs]: T extends KindsOf<R> ? R : never }[Rungs];

type OpenAlways<R, Seen = never> = R extends 'app'
  ? true
  : R extends Rungs
    ? R extends Seen
      ? false
      : Ladder[R] extends { readonly always: true }
        ? OpenAlways<UnderOf<R>, Seen | R>
        : false
    : false;

export type AlwaysOpen = 'app' | { [R in Rungs]: OpenAlways<R> extends true ? R : never }[Rungs];

export type DeepestOpen = Exclude<AlwaysOpen, Above<AlwaysOpen>>;

export type Reach<T> = T extends 'app' ? 'app' : T extends Rungs ? 'app' | T | Above<T> : 'app' | T | RungOfKind<T> | Above<RungOfKind<T>>;

declare const KeyTag: unique symbol;
declare const ViolationTag: unique symbol;

export interface Key<Id extends string, T, Tr extends Tier = Tier> {
  readonly [KeyTag]: { id: Id; of: T; tier: Tr };
}

export type AnyKey = Key<string, unknown>;

export interface TierViolation<Id extends string, Needs extends string> {
  readonly [ViolationTag]: { key: Id; needs: Needs };
}

export type Reachable<Id extends string, Tr extends Tier, R> =
  R extends Key<infer RId, unknown, infer RTier>
    ? Tier extends RTier
      ? R
      : Tier extends Tr
        ? R
        : [RTier] extends [Reach<Tr>]
          ? R
          : TierViolation<Id, RId>
    : R;

export type ReachableFrom<K, R> =
  K extends Key<infer Id, unknown, infer Tr>
    ? Reachable<Id, Tr, R>
    : K extends { readonly key: Key<infer Id, unknown, infer Tr> }
      ? Reachable<Id, Tr, R>
      : R;

export interface Deferred<T> extends PromiseLike<T> {
  readonly current: T | undefined;
  readonly ready: Promise<T>;
}

export interface ServiceDefinition<Tr extends Tier = Tier> {
  readonly tier: Tr;
  readonly eager?: boolean;
  readonly deferred?: boolean;
}

export interface KeyStatic<Id extends string, Self, Tr extends Tier = Tier> extends ServiceDefinition<Tr> {
  readonly id: Id;
  readonly key: Key<Id, Self, Tr>;
  [Symbol.iterator](): Iterator<Key<Id, Self, Tr>, Self, unknown>;
}

declare const OptionalTag: unique symbol;

export interface Optional<K = unknown> {
  readonly [OptionalTag]: K;
}

export type Ask = AnyKey | Optional;

class OptionalRead {
  constructor(readonly key: AnyKeyClass) {}
}

export function optionalOf(asked: unknown): AnyKeyClass | undefined {
  return asked instanceof OptionalRead ? asked.key : undefined;
}

export interface KeyDoors<Self> {
  use<K>(this: K & UseDoor<K>): Self;
  find<K>(this: K & FindDoor<K>): Self | undefined;
  optional<K>(this: K & FindDoor<K>): Generator<Optional<Provided<K>>, Self | undefined, unknown>;
}

export interface SelfMade<Self> {
  make(): Generator<Ask, Self, unknown> | Self;
}

export type KeyClass<Id extends string = string, Self = unknown, Tr extends Tier = Tier> = (abstract new (...args: never[]) => object) &
  KeyStatic<Id, Self, Tr>;

export type SelfMadeKeyClass<Id extends string = string, Self = unknown, Tr extends Tier = Tier> = KeyClass<Id, Self, Tr> & SelfMade<Self>;

export type AnyKeyClass = KeyClass<string, unknown>;

export type AnySelfMadeKeyClass = SelfMadeKeyClass<string, unknown>;

export interface DeferredKeyStatic<Id extends string, Self, Tr extends Tier = Tier> extends ServiceDefinition<Tr> {
  readonly id: Id;
  readonly key: Key<Id, Self, Tr>;
  [Symbol.iterator](): Iterator<Key<Id, Self, Tr>, Deferred<Self>, unknown>;
}

export type DeferredKeyClass<Id extends string = string, Self = unknown, Tr extends Tier = Tier> = (abstract new (
  ...args: never[]
) => object) &
  DeferredKeyStatic<Id, Self, Tr>;

export type ServiceClass<Id extends string, Self, Tr extends Tier> = KeyClass<Id, Self, Tr> & KeyDoors<Self>;
export type DeferredServiceClass<Id extends string, Self, Tr extends Tier> = DeferredKeyClass<Id, Self, Tr> & KeyDoors<Deferred<Self>>;

export type AnyDeferredKeyClass = DeferredKeyClass<string, unknown>;

export type Provided<K> = K extends { readonly key: infer P } ? P : never;
export type Requires<K> = K extends { make(): infer R }
  ? [R] extends [Generator<infer Y, unknown, unknown>]
    ? Extract<Y, AnyKey>
    : never
  : never;
export type InstanceOf<K> = K extends { readonly key: Key<string, infer S> } ? S : never;

export interface Resolver {
  resolve<Self>(key: KeyClass<string, Self>): Self;
  resolveDeferred?<Self>(key: DeferredKeyClass<string, Self>): Promise<Self>;
  resolveHandle?<Self>(key: DeferredKeyClass<string, Self>): Deferred<Self>;
  find?<Self>(key: KeyClass<string, Self>): Self | Deferred<Self> | undefined;
}

let appResolver: (() => Resolver) | undefined;

export function bindAppResolver(read: () => Resolver): void {
  appResolver = read;
}

function useAppResolver(): Resolver {
  if (!appResolver) throw new Error('App is not mounted: X.use() needs App.mount or App.test');
  return appResolver();
}

export function Service<Self>(): {
  <const Id extends string, const Tr extends Tier>(
    id: Id,
    definition: ServiceDefinition<Tr> & { deferred: true },
  ): DeferredServiceClass<Id, Self, Tr>;
  <const Id extends string, const Tr extends Tier>(id: Id, definition: ServiceDefinition<Tr>): ServiceClass<Id, Self, Tr>;
} {
  return (<const Id extends string>(id: Id, definition: ServiceDefinition) => {
    abstract class Base {
      static readonly id: Id = id;
      static readonly tier: Tier = definition.tier;
      static readonly eager: boolean = definition.eager === true;
      static readonly deferred: boolean = definition.deferred === true;

      static get key(): Key<Id, Self> {
        return this as unknown as Key<Id, Self>;
      }

      static make(): Generator<Ask, Self, unknown> | Self {
        throw new Error(`Service "${id}" declares no static make()`);
      }

      static *[Symbol.iterator](): Iterator<Key<Id, Self>, Self, unknown> {
        return (yield this.key) as Self;
      }

      static *optional(): Generator<OptionalRead, Self | Deferred<Self> | undefined, unknown> {
        return (yield new OptionalRead(this as unknown as AnyKeyClass)) as Self | Deferred<Self> | undefined;
      }

      static use(): Self | Deferred<Self> {
        const resolver = useAppResolver();
        if (!definition.deferred) return resolver.resolve(this as unknown as KeyClass<string, Self>);
        if (!resolver.resolveHandle) throw new Error(`Service "${id}" rides a chunk and this resolver cannot hand it over`);
        return resolver.resolveHandle(this as unknown as DeferredKeyClass<string, Self>);
      }

      static find(): Self | Deferred<Self> | undefined {
        const resolver = useAppResolver();
        if (!resolver.find) throw new Error(`Service "${id}": this resolver cannot tell whether a key stands`);
        return resolver.find(this as unknown as KeyClass<string, Self>);
      }
    }

    recipeless.add(Base.make);
    return Base as unknown as ServiceClass<Id, Self, Tier>;
  }) as {
    <const Id extends string, const Tr extends Tier>(
      id: Id,
      definition: ServiceDefinition<Tr> & { deferred: true },
    ): DeferredServiceClass<Id, Self, Tr>;
    <const Id extends string, const Tr extends Tier>(id: Id, definition: ServiceDefinition<Tr>): ServiceClass<Id, Self, Tr>;
  };
}

export function Presenter<Self>(): <const Id extends string, const Tr extends Tier>(
  id: Id,
  definition: { readonly tier: Tr },
) => ServiceClass<Id, Self, Tr> {
  return <const Id extends string, const Tr extends Tier>(id: Id, definition: { readonly tier: Tr }) =>
    Service<Self>()(id, { tier: definition.tier, eager: true });
}

const recipeless = new WeakSet<object>();

export function hasRecipe(key: AnySelfMadeKeyClass): boolean {
  return !recipeless.has(key.make);
}

export function isKeyClass(value: unknown): value is AnySelfMadeKeyClass {
  return typeof value === 'function' && typeof (value as { id?: unknown }).id === 'string' && 'tier' in value;
}

export function isDeferredKey(key: AnyKeyClass): boolean {
  return key.deferred === true;
}
