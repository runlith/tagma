import type { Ambient, Currents, Definition } from './App.js';
import type { AlwaysOpen, AnyKey, DeepestOpen, Key, Ladder, Provided, Reach, Tier } from './key.js';
import type { Named, OutOf, Satisfying, When } from './Layer.js';
import type { Platform } from './Platform.js';
import type { Router } from './Router.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- empty until an application fills it.
export interface Manifest {}

type World = Provided<typeof Platform> | Provided<typeof Router>;

type Unconditional<O> = O extends When<AnyKey, object> ? never : O;
type Keys<O> = O extends When<infer K, object> ? K : O;

export interface Ground<Always, Maybe, Outs = never> {
  readonly always: Always;
  readonly maybe: Maybe;
  readonly outs: Outs;
}

export type GroundOf<M, L = readonly []> = Ground<
  Unconditional<OutOf<M>> | Ambient | World | Currents<L>,
  Keys<OutOf<M>> | Ambient | World | Currents<L>,
  OutOf<M> | Ambient | World | Currents<L>
>;

type AppGround = Manifest extends { readonly app: Definition<infer M, infer L> } ? GroundOf<M, L> : undefined;

type AlwaysOf<G> = G extends Ground<infer A, unknown, unknown> ? A : never;
type MaybeOf<G> = G extends Ground<unknown, infer M, unknown> ? M : never;
type OutsOf<G> = G extends Ground<unknown, unknown, infer O> ? O : never;

type Refusal<Why extends string, What> = { readonly [W in Why]: What };

type Judged<P> = P extends Key<infer Id, unknown, infer Tr> ? (string extends Id ? false : Tier extends Tr ? false : true) : false;

type TierOf<P> = P extends Key<string, unknown, infer Tr> ? Tr : never;

type Rungs = keyof Ladder & string;

type RungOfKind<T> = {
  [R in Rungs]: Ladder[R] extends { readonly kinds: infer K extends string } ? (T extends K ? R : never) : never;
}[Rungs];

type Implied<T> =
  Reach<T> extends infer Reached
    ? Reached extends Rungs
      ? `${Reached}.present`
      : Reached extends 'app'
        ? never
        : Reached extends string
          ? `${RungOfKind<Reached>}.${Reached}.present`
          : never
    : never;

export type UseDoorOn<K, G> = G extends undefined
  ? unknown
  : Provided<K> extends infer P
    ? Judged<P> extends false
      ? unknown
      : [P] extends [AlwaysOf<G>]
        ? [TierOf<P>] extends [AlwaysOpen]
          ? unknown
          : TierOf<P> extends Rungs
            ? Refusal<'exists only while its rung is open: take it with find(), or in a screen of its tier', P>
            : Refusal<'exists only in one kind of its rung: take it with find(), or in a screen of its tier', P>
        : [P] extends [MaybeOf<G>]
          ? Refusal<'the manifest provides it only under a condition: take it with find()', P>
          : Refusal<'not in the manifest', P>
    : never;

export type FindDoorOn<K, G> = G extends undefined
  ? unknown
  : Provided<K> extends infer P
    ? Judged<P> extends false
      ? unknown
      : [P] extends [MaybeOf<G>]
        ? unknown
        : Refusal<'not in the manifest', P>
    : never;

type Yields<K> = K extends { make(...args: never[]): infer R } ? ([R] extends [Generator<infer Y, unknown, unknown>] ? Y : never) : never;

type BuiltAt<K> = K extends { readonly tier: infer T extends Tier | undefined }
  ? [Exclude<T, undefined>] extends [never]
    ? DeepestOpen
    : Tier extends Exclude<T, undefined>
      ? DeepestOpen
      : Exclude<T, undefined>
  : DeepestOpen;

type Unmet<R, T, Outs> = R extends AnyKey
  ? Judged<R> extends false
    ? never
    : [TierOf<R>] extends [Reach<T>]
      ? [When<R, Named<Implied<T>>>] extends [Satisfying<Outs>]
        ? never
        : R
      : R
  : never;

export type BuildDoorOn<K, G> = G extends undefined
  ? unknown
  : [Unmet<Yields<K>, BuiltAt<K>, OutsOf<G>>] extends [never]
    ? unknown
    : Refusal<'needs what the manifest does not provide wherever its tier stands', Unmet<Yields<K>, BuiltAt<K>, OutsOf<G>>>;

export type UseDoor<K> = K extends unknown ? UseDoorOn<K, AppGround> : never;
export type FindDoor<K> = K extends unknown ? FindDoorOn<K, AppGround> : never;
export type BuildDoor<K> = K extends unknown ? BuildDoorOn<K, AppGround> : never;
