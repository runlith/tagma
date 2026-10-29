import { mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Effect, Queue, Schedule, Stream, type Semaphore } from 'effect';
import { Git } from '@runlith/git/Git';
import { GateRefusal, refusalBody } from '../../platform/contract/wire/refusal.js';
import { GraphRecoveries } from '../contract/service/recovery.js';
import { ProjectPolicy, ServingSwitch } from '../contract/service/serving.js';
import type { GraphRecovery, RecoveryAim, RecoveryNotice } from '../contract/wire/recovery.js';
import { resolveStorageLayout, storageHomes } from '../storage/layout.js';
import { ShadowGit } from '../tree/shadow.js';
import { TreeMerges } from '../tree/merges.js';
import { resolveCheckout } from '../tree/conflicts.js';
import { type TreeWatch, type WatchEvent, watchAll } from '../../platform/watch/tree.js';
import { refused } from './refusal.js';
import { overRepositoryAndTree } from './permits.js';
import { writableAt } from './writing.js';

const REOPEN = '1 second';

export const makeRecoveries = Effect.fnUntraced(function* ({
  gates,
  storePath,
}: {
  readonly gates: (key: string) => Semaphore.Semaphore;
  readonly storePath: string;
}) {
  const switching = yield* ServingSwitch;
  const policy = yield* ProjectPolicy;
  const git = yield* Git;

  const at = Effect.fnUntraced(function* (aim: RecoveryAim) {
    const { row, checkout, readOnly } = yield* switching.servedBy(aim);
    const layout = yield* refused(
      resolveStorageLayout({
        mode: row.storage,
        projectId: row.id,
        ...storageHomes(storePath),
        worktree: checkout,
      }),
    );
    if (layout.mode === 'team') return { checkout, readOnly, permit: overRepositoryAndTree(gates, layout) };
    if (layout.mode !== 'stealth') return null;
    const shadow = yield* refused(ShadowGit.open(layout.gitDir, git, row.graphRemote));
    return {
      readOnly,
      merges: TreeMerges.at(shadow, layout.treeRoot),
      permit: overRepositoryAndTree(gates, layout),
      assignment: gates(`graph-recovery:${layout.treeRoot}`),
    };
  });

  const notices = (projectId: number) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const here = yield* at({ projectId });
        if (here === null || 'checkout' in here)
          return Stream.concat(Stream.make<[RecoveryNotice]>({ recovery: null, total: 0, unreadable: [] }), Stream.never);
        const wake = yield* Queue.sliding<void>(1);
        const directory = dirname(here.merges.file);
        const held = new Map<string, GraphRecovery>();
        const unreadable = new Map<string, GateRefusal>();
        const changed = new Set<string>();
        let rescan = true;
        let lost = false;
        let watching: TreeWatch | null = null;
        const io = <A>(work: () => Promise<A>) =>
          Effect.tryPromise({
            try: work,
            catch: (cause) => new GateRefusal('graph-pool', `graph recovery watch failed: ${String(cause)}`, ['reopen the project']),
          });
        const placed = io(() =>
          mkdir(directory).then(
            () => true,
            (cause: NodeJS.ErrnoException) => (cause.code === 'EEXIST' ? true : cause.code === 'ENOENT' ? false : Promise.reject(cause)),
          ),
        );
        const listen = (event: WatchEvent): void => {
          const named = event.paths?.length === 1 && (!('rescan' in event) || event.rescan === 'rename') ? event.paths[0]! : null;
          if ('rescan' in event && (event.rescan === 'error' || event.rescan === 'lost' || event.rescan === 'polling')) lost = true;
          else if (named === null) rescan = true;
          else if (named.endsWith('.json')) changed.add(named);
          else return;
          Queue.offerUnsafe(wake, undefined);
        };
        const gone = () => lost;
        const stop = (): void => {
          watching?.close();
          watching = null;
        };
        const watch = Effect.gen(function* () {
          yield* Effect.repeat(placed, { schedule: Schedule.spaced(REOPEN), until: (there) => there });
          lost = false;
          rescan = true;
          watching = yield* watchAll([{ at: directory, recursive: false, required: true, listen }]);
        });
        yield* Effect.addFinalizer(() => Effect.sync(stop));
        yield* watch;
        return Stream.concat(Stream.make(undefined), Stream.fromQueue(wake)).pipe(
          Stream.mapEffect(() =>
            Effect.gen(function* () {
              while (gone()) {
                stop();
                yield* Effect.sleep(REOPEN);
                yield* watch;
              }
              if (rescan) {
                const listed = yield* io(() =>
                  readdir(directory).catch((cause: NodeJS.ErrnoException) => (cause.code === 'ENOENT' ? null : Promise.reject(cause))),
                );
                if (listed === null) {
                  lost = true;
                  Queue.offerUnsafe(wake, undefined);
                  return null;
                }
                rescan = false;
                for (const name of listed) if (name.endsWith('.json')) changed.add(name);
                for (const name of held.keys()) changed.add(name);
                for (const name of unreadable.keys()) changed.add(name);
              }
              const names = [...changed];
              changed.clear();
              for (const name of names) {
                const file = join(directory, name);
                const record = yield* Effect.result(refused(TreeMerges.readAt(file)));
                if (record._tag === 'Failure') {
                  held.delete(name);
                  unreadable.set(name, record.failure);
                  continue;
                }
                unreadable.delete(name);
                if (record.success === null) held.delete(name);
                else held.set(name, record.success);
              }
              const notice: RecoveryNotice = {
                recovery: held.values().next().value ?? null,
                total: held.size,
                unreadable: [...unreadable].map(([name, error]) => ({
                  file: join(directory, name),
                  error: refusalBody(error),
                })),
              };
              return notice;
            }),
          ),
          Stream.filter((notice: RecoveryNotice | null): notice is RecoveryNotice => notice !== null),
        );
      }),
    );

  return GraphRecoveries.of({
    read: (aim) =>
      Effect.flatMap(at(aim), (here) => (here === null || 'checkout' in here ? Effect.succeed(null) : refused(here.merges.read()))),
    follow: (projectId) =>
      Stream.callback<void>(
        (queue) =>
          Effect.acquireRelease(
            Effect.sync(() =>
              policy.subscribe((event) =>
                event.projectId === projectId && (event.field === 'storage' || event.field === 'graphRemote')
                  ? Effect.asVoid(Queue.offer(queue, undefined))
                  : Effect.void,
              ),
            ),
            (detach) => Effect.sync(detach),
          ).pipe(Effect.andThen(Queue.offer(queue, undefined))),
        { bufferSize: 1, strategy: 'sliding' },
      ).pipe(Stream.switchMap(() => notices(projectId))),
    assign: Effect.fnUntraced(function* <E, R>(
      aim: RecoveryAim,
      id: string,
      create: (recovery: GraphRecovery) => Effect.Effect<string, E, R>,
    ) {
      const here = yield* at(aim);
      if (here === null || 'checkout' in here)
        return yield* new GateRefusal('not-found', 'this project has no isolated graph recovery', ['read_graph_recovery']);
      return yield* here.assignment.withPermit(
        Effect.gen(function* () {
          yield* here.permit(refused(here.merges.restore()));
          const record = yield* here.permit(refused(here.merges.read()));
          if (record === null || record.id !== id)
            return yield* new GateRefusal('not-found', 'this graph recovery is no longer pending', ['read_graph_recovery']);
          if (record.threadId !== null) return record.threadId;
          const threadId = yield* create(record);
          yield* here.permit(refused(here.merges.assign(threadId)));
          return threadId;
        }),
      );
    }),
    finish: Effect.fnUntraced(function* (aim) {
      const here = yield* at(aim);
      if (here === null)
        return yield* new GateRefusal('team-tree', 'this project has no isolated graph merge', ['resolve the merge in its own repository']);
      yield* writableAt(here);
      if (here.checkout !== undefined)
        return yield* here
          .permit(resolveCheckout(git, here.checkout))
          .pipe(
            Effect.mapError((failure) =>
              failure instanceof GateRefusal
                ? failure
                : new GateRefusal('graph-pool', failure.message, ['read the graph merge files and resolve again']),
            ),
          );
      return yield* here.assignment.withPermit(here.permit(refused(Effect.andThen(here.merges.restore(), here.merges.finish()))));
    }),
  });
});
