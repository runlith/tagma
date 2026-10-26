import { Clock, Effect, FileSystem, Option, Schema } from 'effect';
import { and, eq, inArray } from 'drizzle-orm';
import { fileRoot, projectRoot } from '../../workspace/store/tables.js';
import { Git } from '@runlith/git/Git';
import { divergenceAt } from '@runlith/git/history';
import { indexPath } from '../../platform/git/index.js';
import { actingGit } from '../../platform/git/ownGit.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { WorktreeUnavailable } from '../contract/wire/failures.js';
import type { WorktreeFact } from '../contract/wire/rows.js';
import { worktreeState } from '../store/tables.js';
import { StateSnapshot, type Divergence, type StateQuestion } from './rowShapes.js';
import { Capacity } from '../../platform/contract/service/capacity.js';
import { WORKTREE_READS } from '../capacity.js';
import type { TreeMetadata } from './metadata.js';
import { summarize } from './rowEntries.js';

export const factOf = (snapshot: StateSnapshot, metadata: TreeMetadata, base: string | null): WorktreeFact => ({
  state: snapshot.read.head === metadata.head && snapshot.base === base ? 'current' : 'previous',
  head: snapshot.read.head,
  indexStamp: snapshot.indexStamp,
  base: snapshot.base,
  baseTime: snapshot.baseTime,
  takenAt: snapshot.takenAt,
});

type IndexAddress = { readonly path: string; readonly marker: string; readonly index: string };
const statKey = (stat: FileSystem.File.Info | null): string =>
  stat === null
    ? 'missing'
    : `${stat.dev}:${Option.getOrNull(stat.ino)}:${stat.size}:${Option.getOrNull(stat.mtime)?.getTime() ?? ''}:${Option.getOrNull(stat.birthtime)?.getTime() ?? ''}`;

export const makeReadings = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const checkouts = yield* CheckoutRows;
  const capacity = yield* Capacity;
  const files = yield* FileSystem.FileSystem;
  const git = actingGit(yield* Git, 'worktree-listing');
  const kept = new Map<RootId, StateSnapshot>();
  const paths = new Map<RootId, string>();
  const restored = new Map<RootId, string>();
  const locations = new Map<RootId, IndexAddress>();
  const projects = new Map<number, ReadonlySet<RootId>>();
  const references = new Map<RootId, number>();

  const unavailable = (failure: { readonly message: string }) => new WorktreeUnavailable({ reason: 'storage', message: failure.message });
  const save = Effect.fn('WorktreeRows.saveState')(function* (rootId: RootId, path: string, state: StateSnapshot) {
    yield* units.write(writes('worktrees.state', [worktreeState]), (unit) =>
      Effect.gen(function* () {
        const live = yield* unit.run(
          db
            .select({ rootId: fileRoot.rootId })
            .from(fileRoot)
            .innerJoin(projectRoot, eq(projectRoot.rootId, fileRoot.rootId))
            .where(and(eq(fileRoot.rootId, rootId), eq(fileRoot.path, path), eq(fileRoot.state, 'active')))
            .limit(1)
            .get(),
        );
        if (live === undefined)
          return yield* new WorktreeUnavailable({
            reason: 'storage',
            message: `${path} left this installation before its facts could be saved`,
          });
        yield* unit.run(
          db
            .insert(worktreeState)
            .values({
              rootId,
              path,
              head: state.read.head,
              indexStamp: state.indexStamp,
              base: state.base,
              takenAt: state.takenAt,
              state: JSON.stringify(state),
            })
            .onConflictDoUpdate({
              target: worktreeState.rootId,
              set: {
                path,
                head: state.read.head,
                indexStamp: state.indexStamp,
                base: state.base,
                takenAt: state.takenAt,
                state: JSON.stringify(state),
              },
            }),
        );
      }),
    );
    kept.set(rootId, state);
    paths.set(rootId, path);
    restored.set(rootId, path);
  }, Effect.mapError(unavailable));

  const stamp = Effect.fn('WorktreeRows.indexStamp')(
    function* (question: StateQuestion) {
      const { rootId, path, queued } = question;
      const marker = statKey(
        yield* files.stat(`${path}/.git`).pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null))),
      );
      const address = locations.get(rootId);
      let index = address?.path === path && address.marker === marker ? address.index : undefined;
      if (index === undefined) {
        queued?.();
        index = yield* capacity.ticket(
          { name: 'worktree-index-address', class: 'call', needs: [{ pool: WORKTREE_READS, units: 1 }] },
          indexPath(git, path),
        );
        locations.set(rootId, { path, marker, index });
      }
      return statKey(yield* files.stat(index).pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null))));
    },
    Effect.mapError((failure) => new WorktreeUnavailable({ reason: 'filesystem', message: failure.message })),
  );

  return {
    restore: Effect.fn('WorktreeRows.restoreState')(function* (
      projectId: number,
      roots: readonly { readonly rootId: RootId; readonly path: string }[],
    ) {
      const previous = projects.get(projectId) ?? new Set<RootId>();
      const current = new Set(roots.map((root) => root.rootId));
      for (const rootId of previous)
        if (!current.has(rootId)) {
          const left = (references.get(rootId) ?? 1) - 1;
          if (left > 0) references.set(rootId, left);
          else {
            references.delete(rootId);
            kept.delete(rootId);
            paths.delete(rootId);
            restored.delete(rootId);
            locations.delete(rootId);
          }
        }
      for (const rootId of current) if (!previous.has(rootId)) references.set(rootId, (references.get(rootId) ?? 0) + 1);
      projects.set(projectId, current);
      const missing = roots.filter((root) => restored.get(root.rootId) !== root.path);
      const ids = missing.map((root) => root.rootId);
      const rows =
        ids.length === 0
          ? []
          : yield* units.read((unit) => unit.run(db.select().from(worktreeState).where(inArray(worktreeState.rootId, ids)).all()));
      const wanted = new Map(missing.map((root) => [root.rootId as string, root]));
      for (const root of missing)
        if (paths.get(root.rootId) !== root.path) {
          kept.delete(root.rootId);
          paths.delete(root.rootId);
          locations.delete(root.rootId);
        }
      for (const row of rows) {
        if (wanted.get(row.rootId)?.path !== row.path) continue;
        const state = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(StateSnapshot))(row.state);
        const rootId = wanted.get(row.rootId)?.rootId;
        if (rootId !== undefined) {
          if (paths.get(rootId) !== row.path) locations.delete(rootId);
          kept.set(rootId, state);
          paths.set(rootId, row.path);
        }
      }
      for (const root of missing) restored.set(root.rootId, root.path);
      return new Map(
        roots.flatMap((root) => {
          const state = paths.get(root.rootId) === root.path ? kept.get(root.rootId) : undefined;
          return state === undefined ? [] : [[root.rootId, state] as const];
        }),
      );
    }, Effect.mapError(unavailable)),
    read: Effect.fn('WorktreeRows.state')(function* (question: StateQuestion): Effect.fn.Return<StateSnapshot, WorktreeUnavailable> {
      const { rootId, path, metadata, tip, tipTime, mode, queued } = question;
      const indexStamp = metadata.head === null && metadata.ref === null ? 'no-repository' : yield* stamp(question);
      const saved = paths.get(rootId) === path ? kept.get(rootId) : undefined;
      if (mode === 'page' && saved !== undefined && saved.read.head === metadata.head && saved.indexStamp === indexStamp) return saved;
      queued?.();
      return yield* capacity
        .ticket(
          { name: 'worktree-state', class: 'call', needs: [{ pool: WORKTREE_READS, units: 1 }] },
          Effect.gen(function* () {
            const checkout = yield* Effect.mapError(
              mode === 'watched' || saved === undefined
                ? checkouts.read(rootId, tip ?? undefined)
                : checkouts.refresh(rootId, tip ?? undefined),
              (failure) => new WorktreeUnavailable({ reason: 'git', message: failure.message }),
            );
            let distance: Divergence | null =
              saved?.read.head === checkout.head && saved.base === tip && saved.ahead !== null && saved.behind !== null
                ? { ahead: saved.ahead, behind: saved.behind }
                : null;
            if (distance === null && checkout.head !== null && tip !== null)
              distance = yield* divergenceAt(git, path, tip, checkout.head).pipe(
                Effect.mapError((failure) => new WorktreeUnavailable({ reason: 'git', message: failure.message })),
              );
            const state: StateSnapshot = {
              read: summarize(checkout),
              indexStamp,
              base: tip,
              baseTime: tipTime,
              takenAt: yield* Clock.currentTimeMillis,
              ahead: distance?.ahead ?? null,
              behind: distance?.behind ?? null,
            };
            yield* save(rootId, path, state);
            return state;
          }),
        )
        .pipe(Effect.mapError((failure) => new WorktreeUnavailable({ reason: 'git', message: failure.message })));
    }),
  };
});
