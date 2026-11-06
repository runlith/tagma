import type { Adapters, Facet } from '@runlith/code-facts/adapter';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import type { Tree } from '@runlith/code-facts/tree';
import type { Applied } from '../rule';
import { valuedDuplicate, type Violation } from '../verdict';
import type { Budget } from './budget';
import type { InspectionMemo } from './memo';
import type { Reading, ReadingScope, Remapped } from './reading';
import { implementationOf } from './registry';

export const lists = (inspection: Applied, adapters: Adapters = ADAPTERS): readonly string[] =>
  implementationOf(inspection.builtin).lists(inspection.params, adapters);

export const selects = (inspection: Applied, path: string): boolean =>
  implementationOf(inspection.builtin).selects(inspection.params, path);

export const movable = (inspection: Applied, path: string): boolean => {
  const implementation = implementationOf(inspection.builtin);
  return (implementation.movable ?? implementation.selects)(inspection.params, path);
};

export const facetFor = (id: string): Facet<unknown> | undefined => implementationOf(id).facet;

export const prefetches = (id: string): boolean => implementationOf(id).prefetch ?? true;

export const reachKey = (inspection: Applied, slot: string): string | undefined =>
  implementationOf(inspection.builtin).reachKey?.(inspection.params, slot);

const uniqueValued = (builtin: string, violations: readonly Violation[]): void => {
  const repeated = valuedDuplicate(violations);
  if (repeated !== undefined)
    throw new Error(`${builtin} reported \`${repeated}\` more than once with a value, and a measured key must be unique`);
};

export const inspect = (
  inspection: Applied,
  tree: Tree,
  paths: readonly string[],
  budget: Budget,
  adapters: Adapters = ADAPTERS,
  memo?: InspectionMemo,
  scope: ReadingScope = 'reach',
): Reading => {
  const read = implementationOf(inspection.builtin).read(
    inspection.params,
    tree,
    paths.filter((path) => tree.has(path)),
    adapters,
    budget,
    memo,
    scope,
  );
  uniqueValued(inspection.builtin, read.violations);
  return read;
};

export const remapped = (
  inspection: Applied,
  before: Applied,
  tree: Tree,
  fingerprints: readonly string[],
  budget: Budget,
  adapters: Adapters = ADAPTERS,
  memo?: InspectionMemo,
): Remapped | undefined =>
  inspection.builtin === before.builtin
    ? implementationOf(inspection.builtin).remapped?.(inspection.params, before.params, tree, fingerprints, adapters, budget, memo)
    : undefined;

export const affected = (
  inspection: Applied,
  base: Tree,
  built: Tree,
  paths: readonly string[],
  budget: Budget,
  adapters: Adapters = ADAPTERS,
  memo?: InspectionMemo,
): readonly string[] =>
  implementationOf(inspection.builtin).affected?.(inspection.params, base, built, paths, adapters, budget, memo) ?? [];
