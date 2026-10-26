import { availableParallelism } from 'node:os';
import { type Cause, Clock, Effect, Queue, Stream } from 'effect';
import { Git } from '@runlith/git/Git';
import { ignoredPaths } from '@runlith/git/entries';
import { actingGit } from '../../platform/git/ownGit.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { PlaceSpace } from '../contract/service/space.js';
import { type WorktreeRowRefusal, WorktreeRows } from '../contract/service/listing.js';
import type { SpaceScanEvent } from '../contract/wire/space.js';
import { walk, type WalkBounds } from './walk.js';

const BOUNDS: WalkBounds = { readers: Math.max(2, availableParallelism()), progressEvery: 20_000, items: 10 };

const IGNORED_CAPTURE = 16 * 1024 * 1024;

type Ignored = { readonly paths: ReadonlySet<string>; readonly failure?: string };

export const makeSpaceScans = Effect.fnUntraced(function* (input: { readonly bounds?: WalkBounds } = {}) {
  const listing = yield* WorktreeRows;
  const git = actingGit(yield* Git, 'worktree-space');
  const bounds = input.bounds ?? BOUNDS;

  const ignored = (folder: string): Effect.Effect<Ignored> =>
    Effect.map(Effect.result(ignoredPaths(git, folder, { capture: IGNORED_CAPTURE })), (read): Ignored =>
      read._tag === 'Success'
        ? { paths: new Set(read.success.map((path) => (path.endsWith('/') ? path.slice(0, -1) : path))) }
        : {
            paths: new Set(),
            failure: `git could not list what it ignores here (${read.failure._tag}), so nothing is counted reclaimable`,
          },
    );

  const scanned = Effect.fn('PlaceSpace.scan')(function* (
    projectId: number,
    rootId: RootId,
    queue: Queue.Queue<SpaceScanEvent, GateRefusal<WorktreeRowRefusal | 'not-found'> | Cause.Done>,
  ) {
    const rows = yield* listing.rows(projectId);
    const row = rows.find((one) => one.rootId === rootId);
    if (row === undefined) {
      return yield* new GateRefusal('not-found', `no standing place ${rootId} in project ${projectId}`, [
        'read the project\u2019s places again and scan one it lists',
      ]);
    }
    const unlisted = yield* ignored(row.folder);
    const walked = yield* Effect.tryPromise({
      try: (signal) =>
        walk(row.folder, unlisted.paths, bounds, signal, (entries, bytes) => {
          Queue.offerUnsafe(queue, { _tag: 'Progress', entries, bytes });
        }),
      catch: (cause) =>
        new GateRefusal(
          'root-unavailable',
          `the place's folder could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
          ['check that the place\u2019s folder still stands, then scan again'],
        ),
    });
    const scannedAt = yield* Clock.currentTimeMillis;
    Queue.offerUnsafe(queue, {
      _tag: 'Scanned',
      rootId,
      path: row.folder,
      scannedAt,
      ...walked,
      ignored: unlisted.failure,
    });
    yield* Queue.end(queue);
  });

  return PlaceSpace.of({
    scan: (projectId, rootId) =>
      Stream.callback<SpaceScanEvent, GateRefusal<WorktreeRowRefusal | 'not-found'>>((queue) =>
        Effect.forkScoped(
          Effect.exit(scanned(projectId, rootId, queue)).pipe(
            Effect.flatMap((exit) => (exit._tag === 'Failure' ? Queue.failCause(queue, exit.cause) : Effect.void)),
          ),
        ),
      ),
  });
});
