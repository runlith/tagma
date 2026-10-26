import { existsSync } from 'node:fs';
import { Context, Effect } from 'effect';
import { commitOf } from '@runlith/git/repository';
import { Git } from '@runlith/git/Git';
import { MachineStore } from '../../platform/contract/service/store.js';
import { graphChangesAt } from '../tree/branchChanges.js';
import { resolveStorageLayout, storageHomes } from '../storage/layout.js';
import { CHECKOUT_DIRECTORY } from '../contract/wire/storage.js';
import type { GraphChanges } from '../contract/wire/branchChanges.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { Tags } from '../contract/service/vocabulary.js';
import { type ServedGraphs, ServingSwitch } from '../contract/service/serving.js';

const CHANGES_KEPT = 64;

export type BranchPlace = { readonly projectId: number; readonly checkout: string; readonly branch: string; readonly base: string };

export const makeBranchChanges = Effect.fnUntraced(function* (graphs: ServedGraphs['Service']) {
  const git = yield* Git;
  const machineStore = yield* MachineStore;
  const servingSwitch = yield* ServingSwitch;
  const changesRead = new Map<string, { readonly table: TagTable; readonly counted: GraphChanges }>();

  return Effect.fnUntraced(
    function* (place: BranchPlace) {
      const { row, checkout } = yield* servingSwitch.servedBy({ projectId: place.projectId, cwd: place.checkout });
      const layout = yield* resolveStorageLayout({
        mode: row.storage,
        projectName: row.name,
        ...storageHomes(machineStore.path),
        worktree: checkout,
      });
      if (layout.mode === 'stealth' && !existsSync(layout.gitDir)) {
        return { status: 'unread' as const, reason: 'this project keeps no graph store yet' };
      }
      const dir = layout.mode === 'team' ? checkout : layout.gitDir;
      const under = layout.mode === 'team' ? CHECKOUT_DIRECTORY : null;
      const tip = yield* commitOf(git, dir, `refs/heads/${place.branch}`);
      const base = yield* commitOf(git, dir, `refs/heads/${place.base}`);
      if (tip === null) return { status: 'counted' as const, kinds: [], files: 0, unsorted: 0, unreadable: [] };
      if (base === null) return { status: 'unread' as const, reason: `${place.base} has no graph to compare against yet` };
      const held = yield* graphs.holdServed({ projectId: place.projectId, checkout });
      const graph = held ?? (yield* graphs.resolve({ projectId: place.projectId }));
      const table = yield* Context.get(graph.context, Tags).of(place.projectId);
      const key = `${dir}\u0000${base}\u0000${tip}`;
      const kept = changesRead.get(key);
      if (kept !== undefined && kept.table === table) return kept.counted;
      const read = yield* Effect.result(graphChangesAt(git, dir, base, tip, under, table));
      if (read._tag === 'Failure') return { status: 'unread' as const, reason: read.failure.message };
      const counted = read.success;
      changesRead.delete(key);
      changesRead.set(key, { table, counted });
      for (const older of changesRead.keys()) {
        if (changesRead.size <= CHANGES_KEPT) break;
        changesRead.delete(older);
      }
      return counted;
    },
    (effect): Effect.Effect<GraphChanges> =>
      Effect.map(Effect.result(Effect.scoped(effect)), (read) =>
        read._tag === 'Success' ? read.success : { status: 'unread' as const, reason: read.failure.message },
      ),
  );
});
