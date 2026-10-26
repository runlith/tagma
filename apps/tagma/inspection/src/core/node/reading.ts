import type { Adapters, Facet } from '@runlith/code-facts/adapter';
import type { Tree } from '@runlith/code-facts/tree';
import type { RunOf } from '../catalog';
import type { Envelope, Pack } from '../rule';
import type { Unjudged, Violation } from '../verdict';
import type { Budget } from './budget';
import type { Change, InspectionMemo } from './memo';
import type { Plan, Scope, Sliced } from './slices';

export type Reading = {
  readonly violations: readonly Violation[];
  readonly unjudged: readonly Unjudged[];
};

export type Footprint = { readonly region: boolean; readonly files: readonly string[] };

export type Remapped = { readonly paths: readonly string[]; readonly footprint: Footprint };

export type ReadingScope = 'reach' | 'change';

export type Near<S = unknown> = { readonly snapshot: S; readonly changes: readonly Change[] };

export type Slicing<P, S = unknown> = {
  snapshot(params: P, tree: Tree, near?: Near<S>): S;
  carries(params: P, before: Tree, after: Tree, changes: readonly Change[]): boolean;
  compares(params: P): readonly string[];
  plan(params: P, tree: Tree, places: readonly string[], envelope: Envelope, snapshot?: S): Plan;
  measured(
    params: P,
    tree: Tree,
    scope: Scope,
    memo: InspectionMemo,
    trusted?: InspectionMemo,
    snapshot?: S,
    places?: readonly string[],
  ): Sliced;
  read(
    params: P,
    tree: Tree,
    scope: Scope,
    memo?: InspectionMemo,
    trusted?: InspectionMemo,
    snapshot?: S,
    places?: readonly string[],
  ): Sliced;
};

export type Implementation<P> = {
  readonly facet?: Facet<unknown>;
  readonly prefetch?: boolean;
  readonly reachKey?: (params: P, slot: string) => string;
  readonly lists: (params: P, adapters: Adapters) => readonly string[];
  readonly selects: (params: P, path: string) => boolean;
  readonly movable?: (params: P, path: string) => boolean;
  readonly read: (
    params: P,
    tree: Tree,
    paths: readonly string[],
    adapters: Adapters,
    budget: Budget,
    memo?: InspectionMemo,
    scope?: ReadingScope,
  ) => Reading;
  readonly affected?: (
    params: P,
    base: Tree,
    built: Tree,
    paths: readonly string[],
    adapters: Adapters,
    budget: Budget,
    memo?: InspectionMemo,
  ) => readonly string[];
  readonly remapped?: (
    params: P,
    before: P,
    tree: Tree,
    fingerprints: readonly string[],
    adapters: Adapters,
    budget: Budget,
    memo?: InspectionMemo,
  ) => Remapped | undefined;
  readonly slices?: Slicing<P>;
};

export type ImplementationsOf<P extends Pack> = { readonly [R in P['rules'][number] as R['id']]: Implementation<RunOf<R>> };
