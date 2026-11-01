import { Clock, Context, type Duration, Effect, type Exit, FiberMap, Option, Stream, Tracer } from 'effect';
import { flight } from '@runlith/held/Flight';
import { CEILINGS } from '../../platform/contract/service/deadlines.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { worktreePendingMerge } from '../store/tables.js';
import { CheckoutHoldings, CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import { actorOfPrincipal } from '../../executions/terminals/principals.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { WorktreeUnavailable } from '../../worktrees/contract/wire/failures.js';
import { pendingOf, type PendingRecord } from '../store/pendingMerges.js';
import { type MergeRequest, Merges, PendingMerges } from '../contract/service/merges.js';
import { WorktreeFinishRefused } from '../../worktrees/contract/wire/failures.js';
import { finishRefusalOf } from '../../worktrees/retirement/finishing.js';
import { basisOf, readStanding } from './basis.js';
import { PendingBoard } from './board.js';

export const BASE_BUSY: ReadonlySet<string> = new Set(['base-held', 'base-staged', 'base-mid-operation', 'finishing-busy']);

const GONE: ReadonlySet<string> = new Set(['not-found']);

const TRANSIENT: ReadonlySet<string> = new Set(['git-unreadable', 'git-incomplete']);

export const PENDING_RETRY = '2 minutes';

const SETTLE = '500 millis';

type Seen = { readonly head: string | null; readonly staged: ReadonlySet<string> };

export const makeMergeQueue = Effect.fnUntraced(function* (input: { readonly retry?: Duration.Input } = {}) {
  const units = yield* MachineUnits;
  const { store, moves } = yield* PendingBoard;
  const merges = yield* Merges;
  const checkouts = yield* CheckoutRows;
  const holdings = yield* CheckoutHoldings;
  const retry = input.retry ?? PENDING_RETRY;
  const watchers = yield* FiberMap.make<RootId>();
  const tries = yield* flight<RootId, boolean, never>({
    name: 'merge-tries',
    owner: 'landing',
    key: (rootId) => rootId,
    ceiling: CEILINGS.callCap,
  });

  const stored = <A, E extends { readonly message: string }>(work: Effect.Effect<A, E>) =>
    Effect.mapError(work, (failure) => new WorktreeUnavailable({ reason: 'storage', message: failure.message }));

  const attempt = (
    projectId: number,
    rootId: RootId,
    ask: MergeRequest,
    waited: { readonly queuedAt: Date; readonly attempts: number } | null,
  ) => {
    const end = ask.end === null ? null : actorOfPrincipal(ask.end, projectId);
    return Effect.uninterruptible(
      merges.merge(projectId, rootId, {
        mode: ask.mode,
        after: ask.after,
        message: ask.message ?? undefined,
        waited: waited ?? undefined,
        end: end ?? undefined,
        caller: ask.caller,
      }),
    );
  };

  const exclusive = Effect.fnUntraced(function* <A, E>(
    rootId: RootId,
    work: Effect.Effect<A, E>,
  ): Effect.fn.Return<A, E | WorktreeFinishRefused> {
    for (;;) {
      let mine: Exit.Exit<A, E> | undefined;
      yield* tries
        .join(
          rootId,
          Effect.map(Effect.exit(work), (exit) => {
            mine = exit;
            return false;
          }),
        )
        .pipe(
          Effect.catchTags({
            HoldStalled: (stalled) =>
              Effect.fail(
                new WorktreeFinishRefused({
                  reason: 'finishing-busy',
                  message: `another merge act on ${rootId} ran for the ${Math.round(stalled.waitedMs / 1000)} s this call could wait`,
                  unblock: ['read which act is under way: list_worktrees', 'ask again once it has ended'],
                }),
              ),
            ReentrantCall: (reentry) => Effect.die(reentry),
          }),
        );
      if (mine !== undefined) return yield* mine;
    }
  });

  const standingAt = readStanding(checkouts, holdings);

  const read = (projectId: number, rootId: RootId, known: RootId | null) =>
    Effect.mapError(
      Effect.flatMap(
        known === null ? Effect.map(Effect.option(merges.baseRootOf(projectId, rootId)), Option.getOrNull) : Effect.succeed(known),
        (base) => standingAt(rootId, base),
      ),
      (failure) =>
        new WorktreeUnavailable({ reason: 'git', message: `what a refusal of ${rootId} rests on could not be read: ${failure.message}` }),
    );

  const dropped = Effect.fnUntraced(function* (projectId: number, standing: PendingRecord) {
    const gone = yield* stored(
      units.write(writes('PendingMerges.retried', [worktreePendingMerge]), (unit) => store.replace(standing, null, unit)),
    );
    if (gone) moves.tell(projectId);
    return gone;
  });

  const judged = Effect.fnUntraced(function* (projectId: number, standing: PendingRecord, base: RootId | null) {
    const now = basisOf(standing.refusal?.code ?? '', yield* read(projectId, standing.rootId, base));
    return now !== standing.stoppedOn;
  });

  const changed = Effect.fnUntraced(
    function* (projectId: number, rootId: RootId, base: RootId | null) {
      const standing = yield* stored(units.read((unit) => store.byRoot(rootId, unit)));
      if (standing === null) return true;
      return standing.state === 'stopped' ? yield* retried(projectId, rootId, base) : false;
    },
    (effect, _projectId, rootId) =>
      Effect.catchTag(effect, 'WorktreeUnavailable', (unavailable) =>
        Effect.as(Effect.logWarning('a stopped merge is judged again at its next change', { rootId, reason: unavailable.message }), false),
      ),
  );

  const retried = Effect.fnUntraced(
    function* (projectId: number, rootId: RootId, base: RootId | null) {
      const standing = yield* stored(units.read((unit) => store.byRoot(rootId, unit)));
      if (standing === null) return true;
      if (standing.state === 'stopped' && !(yield* judged(projectId, standing, base))) return false;
      const before = yield* Effect.option(read(projectId, rootId, base));
      const ask: MergeRequest = {
        mode: standing.mode,
        message: standing.message,
        after: standing.after,
        end: standing.end,
        caller: standing.caller ?? undefined,
      };
      const trying: PendingRecord = { ...standing, state: 'waiting', stoppedOn: null, attempts: standing.attempts + 1 };
      const claimed = yield* stored(
        units.write(writes('PendingMerges.retried', [worktreePendingMerge]), (unit) => store.replace(standing, trying, unit)),
      );
      if (!claimed) return false;
      const merged = yield* Effect.result(attempt(projectId, rootId, ask, { queuedAt: trying.queuedAt, attempts: trying.attempts }));
      if (merged._tag === 'Success') {
        moves.tell(projectId);
        return true;
      }
      const refusal = finishRefusalOf(merged.failure);
      if (GONE.has(refusal.code)) return yield* dropped(projectId, trying);
      const waiting = BASE_BUSY.has(refusal.code) || !(merged.failure._tag === 'WorktreeFinishRefused') || TRANSIENT.has(refusal.code);
      const after = waiting ? Option.none() : yield* Effect.option(read(projectId, rootId, base));
      const was = Option.map(before, (standing) => basisOf(refusal.code, standing));
      const stood = Option.filter(
        Option.map(after, (standing) => basisOf(refusal.code, standing)),
        (now) => Option.contains(was, now),
      );
      const next: PendingRecord = Option.isSome(stood)
        ? { ...trying, state: 'stopped', refusal, stoppedOn: stood.value }
        : { ...trying, refusal };
      const kept = yield* stored(
        units.write(writes('PendingMerges.retried', [worktreePendingMerge]), (unit) => store.replace(trying, next, unit)),
      );
      moves.tell(projectId);
      return !kept;
    },
    (effect, _projectId, rootId) =>
      Effect.catchTag(effect, 'WorktreeUnavailable', (unavailable) =>
        Effect.as(
          Effect.logWarning('a merge waiting for its base stays queued until its next try', { rootId, reason: unavailable.message }),
          false,
        ),
      ),
  );

  const watch = Effect.fnUntraced(function* (record: PendingRecord, now = false) {
    const loop = Effect.gen(function* () {
      const place = yield* Effect.result(merges.baseRootOf(record.projectId, record.rootId));
      if (place._tag === 'Failure')
        yield* Effect.logWarning('the pending merge base could not be read', { rootId: record.rootId, reason: place.failure.message });
      const base = place._tag === 'Success' ? place.success : null;
      const signalsOf = (root: RootId, free: boolean) =>
        checkouts.subscribe(root).pipe(
          Stream.debounce(SETTLE),
          Stream.mapAccum(
            (): Seen | undefined => undefined,
            (last, state) => {
              const staged = new Set(state.entries.staged.entries.map((entry) => entry.path));
              const unstaged = last !== undefined && [...last.staged].some((path) => !staged.has(path));
              const freed = free && state.operation === 'none' && (staged.size === 0 || unstaged);
              const moved = state.head !== last?.head || freed;
              return [{ head: state.head, staged }, [moved ? ('move' as const) : ('change' as const)]] as const;
            },
          ),
          Stream.catch((failure) =>
            Stream.unwrap(
              Effect.as(
                Effect.logWarning('a pending merge hears no more from this checkout until it is watched again', {
                  rootId: record.rootId,
                  checkout: root,
                  reason: failure.message,
                }),
                Stream.never,
              ),
            ),
          ),
        );
      const signals = Stream.mergeAll(
        [
          signalsOf(record.rootId, false),
          ...(base === null ? [] : [signalsOf(base, true)]),
          Stream.map(Stream.drop(Stream.tick(retry), 1), () => 'move' as const),
        ],
        { concurrency: 'unbounded' },
      );
      const step = (signal: 'move' | 'change') =>
        exclusive(
          record.rootId,
          signal === 'change' ? changed(record.projectId, record.rootId, base) : retried(record.projectId, record.rootId, base),
        ).pipe(
          Effect.catchTag('WorktreeFinishRefused', (busy) =>
            Effect.as(
              Effect.logWarning('a pending merge is judged again at its next signal', { rootId: record.rootId, reason: busy.message }),
              false,
            ),
          ),
        );
      yield* (now ? Stream.prepend(signals, ['move' as const]) : signals).pipe(
        Stream.mapEffect(step),
        Stream.takeUntil((ended) => ended),
        Stream.runDrain,
      );
    });
    const detached = Effect.updateContext(loop, (context: Context.Context<never>) => Context.omit(Tracer.ParentSpan)(context));
    yield* FiberMap.run(watchers, record.rootId, detached);
  });

  return PendingMerges.of({
    merge: Effect.fnUntraced(function* (projectId, rootId, ask, queue) {
      return yield* exclusive(
        rootId,
        Effect.gen(function* () {
          const standing = yield* stored(units.read((unit) => store.byRoot(rootId, unit)));
          const merged = yield* Effect.result(attempt(projectId, rootId, ask, null));
          if (merged._tag === 'Success') {
            if (standing !== null) {
              yield* FiberMap.remove(watchers, rootId);
              moves.tell(projectId);
            }
            return merged.success;
          }
          const failure = merged.failure;
          if (!queue || failure._tag !== 'WorktreeFinishRefused' || !BASE_BUSY.has(failure.reason)) {
            return yield* Effect.fail(failure);
          }
          const record: PendingRecord = {
            rootId,
            projectId,
            mode: ask.mode,
            message: ask.message,
            after: ask.after,
            state: 'waiting',
            queuedAt: new Date(yield* Clock.currentTimeMillis),
            attempts: 1,
            refusal: finishRefusalOf(failure),
            stoppedOn: null,
            end: ask.end,
            caller: ask.caller ?? null,
          };
          yield* stored(units.write(writes('PendingMerges.merge', [worktreePendingMerge]), (unit) => store.put(record, unit)));
          yield* watch(record);
          moves.tell(projectId);
          return { rootId, queued: pendingOf(record) };
        }),
      );
    }),
    cancel: Effect.fnUntraced(function* (projectId, rootId) {
      return yield* exclusive(
        rootId,
        Effect.gen(function* () {
          const standing = yield* stored(units.read((unit) => store.byRoot(rootId, unit)));
          const dropped =
            standing !== null &&
            standing.projectId === projectId &&
            (yield* stored(
              units.write(writes('PendingMerges.drop', [worktreePendingMerge]), (unit) => store.replace(standing, null, unit)),
            ));
          if (standing === null || !dropped) {
            return yield* new WorktreeFinishRefused({
              reason: 'not-pending',
              message: `no merge of ${rootId} waits for its base`,
              unblock: ["read the worktree's row: list_worktrees answers `pending` where a merge waits"],
            });
          }
          yield* FiberMap.remove(watchers, rootId);
          moves.tell(projectId);
          return { rootId, cancelled: pendingOf(standing) };
        }),
      );
    }),
    onMoved: moves.onMoved,
    ofProject: (projectId) => Effect.map(stored(units.read((unit) => store.ofProject(projectId, unit))), (rows) => rows.map(pendingOf)),
    resume: Effect.fnUntraced(function* () {
      const rows = yield* stored(units.read((unit) => store.all(unit)));
      for (const row of rows) yield* watch(row, true);
      return rows.length;
    }),
  });
});
