import { Effect, type Semaphore } from 'effect';
import type { StorageLayout } from '../storage/layout.js';

export type PermitHold = <A, E, R>(act: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;

export const shadowGateKey = (layout: StorageLayout): string | null => (layout.mode === 'team' ? null : `shadow:${layout.gitDir}`);

export const treeGateKey = (treeRoot: string): string => `fresh:${treeRoot}`;

export const entryGateKey = (treeRoot: string): string => treeRoot;

export const mirrorGateKey = (path: string): string => `mirror:${path}`;

export const overMirror = (gates: (key: string) => Semaphore.Semaphore, path: string): PermitHold => {
  const permit = gates(mirrorGateKey(path));
  return (act) => holding(permit, 'mirrorPermit.wait', act);
};

const holding = <A, E, R>(permit: Semaphore.Semaphore, name: string, act: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.acquireRelease(Effect.withSpan(name)(permit.take(1)), () => permit.release(1), {
        interruptible: true,
      });
      return yield* act;
    }),
  );

export const overEntry = (gates: (key: string) => Semaphore.Semaphore, treeRoot: string): PermitHold => {
  const permit = gates(entryGateKey(treeRoot));
  return (act) => permit.withPermits(1)(act);
};

export const overTree = (gates: (key: string) => Semaphore.Semaphore, treeRoot: string): PermitHold => {
  const permit = gates(treeGateKey(treeRoot));
  return (act) => holding(permit, 'treePermit.wait', act);
};

export const overRepository = (gates: (key: string) => Semaphore.Semaphore, layout: StorageLayout): PermitHold => {
  const key = shadowGateKey(layout);
  if (key === null) return (act) => act;
  const permit = gates(key);
  return (act) => holding(permit, 'repositoryPermit.wait', act);
};

export const overRepositoryAndTree = (gates: (key: string) => Semaphore.Semaphore, layout: StorageLayout): PermitHold => {
  const tree = overTree(gates, layout.treeRoot);
  const repository = overRepository(gates, layout);
  return (act) => repository(tree(act));
};
