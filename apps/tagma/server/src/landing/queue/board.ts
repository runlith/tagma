import { Context, Effect, Layer } from 'effect';
import { MachineStore, type StoreDb } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { RetirementSettlement } from '../../worktrees/contract/service/retirement.js';
import { PendingMergeReads } from '../../worktrees/contract/service/pending.js';
import { pendingMergeStore, type PendingMergeStore, pendingOf } from '../store/pendingMerges.js';
import { worktreePendingMerge } from '../store/tables.js';

export const pendingMoves = () => {
  const told = new Set<(projectId: number) => void>();
  return {
    tell: (projectId: number): void => {
      for (const listener of told) listener(projectId);
    },
    onMoved: (listener: (projectId: number) => void): (() => void) => {
      told.add(listener);
      return () => {
        told.delete(listener);
      };
    },
  };
};

export type PendingMoves = ReturnType<typeof pendingMoves>;

export type LandingStore = {
  readonly pending: PendingMergeStore;
  readonly settlement: RetirementSettlement['Service'];
};

export const landingStore = (db: StoreDb<'machine'>): LandingStore => {
  const pending = pendingMergeStore(db);
  return {
    pending,
    settlement: {
      writes: writes('landing.dropPendingMerge', [worktreePendingMerge]),
      dropPendingMerge: (rootId, unit) => Effect.asVoid(pending.drop(rootId, unit)),
    },
  };
};

export class PendingBoard extends Context.Service<PendingBoard, { readonly store: PendingMergeStore; readonly moves: PendingMoves }>()(
  'tagma/landing/PendingBoard',
) {}

export const pendingBoardLayer: Layer.Layer<PendingBoard | PendingMergeReads | RetirementSettlement, never, MachineStore | MachineUnits> =
  Layer.effectContext(
    Effect.gen(function* () {
      const { db } = yield* MachineStore;
      const units = yield* MachineUnits;
      const { pending: store, settlement } = landingStore(db);
      const moves = pendingMoves();
      return Context.make(PendingBoard, { store, moves }).pipe(
        Context.add(RetirementSettlement, settlement),
        Context.add(PendingMergeReads, {
          ofProject: (projectId) =>
            Effect.mapError(
              Effect.map(
                units.read((unit) => store.ofProject(projectId, unit)),
                (rows) => rows.map(pendingOf),
              ),
              (failure) => ({ message: failure.message }),
            ),
          onMoved: moves.onMoved,
        }),
      );
    }),
  );
