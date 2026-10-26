import { Clock, Cause, Context, Effect, Exit, FiberSet, Scope } from 'effect';
import { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import type { ThreadLiveFeed } from '@runlith/agent/thread/run/ThreadLiveFeed';
import { ThreadLaunchGate, ThreadLive } from '../contract/service/engine.js';
import type { NativeThreadState } from '../contract/service/state.js';
import { gated } from '../projectGate.js';
import { lineageOf } from '../ownLineage.js';
import { OPERATOR_PRINCIPAL, type Actor } from '../../platform/contract/wire/actor.js';
import { ThreadReleasing } from '../contract/service/releasing.js';
import { LIST_WINDOW_ROWS, type ThreadPhase } from '../contract/wire/list.js';
import type { ThreadArchiveSweep } from '../contract/wire/sweep.js';
import { admitThreadFailures } from '../refusals.js';
import { ThreadInputRefused, ThreadWriteConflict, type HarnessFailure } from '../contract/service/failure.js';
import { THREAD_OPERATIONS } from '../contract/wire/operations/catalog.js';
import { phaseChanges, ThreadPhaseFeed } from './phase.js';
import { standingSignal } from '../events/standing.js';
import { ThreadAudience } from './audience.js';
import { ThreadRollouts } from '../contract/service/rollouts.js';
import {
  ThreadList,
  type ArchiveWork,
  type AttentionEvent,
  type OpenCalls,
  type ThreadProjectionPage,
  type ThreadProjectionWindow,
  type ThreadsEvent,
} from '../contract/service/list.js';
import { ThreadLookup, ThreadReading, ThreadRunning, ThreadShelving, ThreadWindows } from '../contract/service/reads.js';
import type { ThreadCursor, ThreadSelection } from './select.js';
import type { ThreadListProjection, ThreadSummary } from './summary.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { HeldPathCounts } from '../contract/service/parts.js';
import type { ThreadHeld } from '../../change-record/contract/wire/holdings.js';

const NONE_HELD: ThreadHeld = { paths: 0, unproven: 0 };
type HeldCount = { readonly projectId: number; readonly held: ThreadHeld };

function recordedPhase(row: ThreadSummary): ThreadPhase | null {
  const recorded = row.activeRun?.phase;
  return recorded === undefined || recorded === null ? null : { phase: recorded.phase, since: recorded.since, calls: [], queued: 0 };
}

export const makeThreadList = Effect.gen(function* () {
  const threads = {
    ...(yield* ThreadLookup),
    ...(yield* ThreadWindows),
    ...(yield* ThreadRunning),
    ...(yield* ThreadShelving),
    ...(yield* ThreadReading),
  };
  const records = yield* ThreadRecords;
  const live = yield* ThreadLive;
  const gate = yield* ThreadLaunchGate;
  const rollouts = yield* ThreadRollouts;
  const heldPathsOf = yield* HeldPathCounts;
  const releasing = yield* ThreadReleasing;
  let archiving: ArchiveWork | null = null;
  let openCalls: OpenCalls | null = null;
  const closeWork: ArchiveWork = (ids, work) =>
    archiving === null
      ? Effect.fail(
          new ThreadInputRefused('thread-commands-standing', 'No thread engine serves to end the work being archived.', [
            'repeat the archive once the thread engine serves',
          ]),
        )
      : archiving(ids, work);
  const runFork = yield* FiberSet.makeRuntime<never, void, never>();
  const listeners = new Map<number, Set<(event: ThreadsEvent) => void>>();
  const audience = new ThreadAudience();
  const resyncing = new Map<number, { readonly behind: { readonly event: ThreadsEvent; readonly attention: boolean }[]; again: boolean }>();

  const observers = new Map<string, Set<() => void>>();
  const everyone = new Set<(event: AttentionEvent) => void>();
  const signals = new Map<string, string>();
  const unwatched = (): boolean => listeners.size === 0 && everyone.size === 0;

  const deliver = (projectId: number, event: ThreadsEvent, attention = true): void => {
    for (const listener of listeners.get(projectId) ?? []) {
      try {
        listener(event);
      } catch (error) {
        console.error('[tagma] a thread list listener threw', { projectId, kind: event.kind }, error);
      }
    }
    if (!attention || (event.kind !== 'row' && event.kind !== 'removed')) return;
    for (const listener of everyone) {
      try {
        listener(event);
      } catch (error) {
        console.error('[tagma] an attention listener threw', { projectId, kind: event.kind }, error);
      }
    }
  };

  const fan = (projectId: number, event: ThreadsEvent, observed = true, attention = true): void => {
    const subject = event.kind === 'row' ? event.row.id : event.kind === 'removed' ? event.threadId : null;
    if (observed && subject !== null) {
      for (const notify of observers.get(subject) ?? []) {
        try {
          notify();
        } catch (error) {
          console.error('[tagma] a thread observer threw', { projectId, kind: event.kind }, error);
        }
      }
    }
    if (event.kind === 'removed') {
      if (attention) {
        heldPaths.delete(event.threadId);
        signals.delete(event.threadId);
      }
    }
    if (event.kind === 'row') audience.include(projectId, [event.row.id]);
    else if (event.kind === 'removed') {
      audience.remove(projectId, event.threadId);
      releaseCounts([event.threadId]);
    }
    const reading = resyncing.get(projectId);
    if (reading === undefined) deliver(projectId, event, attention);
    else reading.behind.push({ event, attention });
  };

  const phases = new ThreadPhaseFeed({
    watch: (threadId, listener) => live.subscribe(threadId, (event) => listener(phaseChanges(event))),
    view: (threadId) => live.view(threadId),
    journal: (threadId, runId, deliver) => {
      if (openCalls === null) {
        deliver([]);
        return;
      }
      runFork(
        Effect.map(Effect.exit(openCalls(threadId, runId)), (exit) => {
          if (Exit.isSuccess(exit)) {
            deliver(exit.value);
            return;
          }
          deliver([]);
          console.error('[tagma] open calls of a followed run could not be read', { threadId, runId }, Cause.squash(exit.cause));
        }),
      );
    },
    onChanged: (threadId) => {
      if (listeners.size === 0) return;
      runFork(
        watchedSummary(threadId).pipe(
          Effect.map((row) => {
            if (row !== undefined) announce(row, false);
          }),
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              console.error('[tagma] thread phase projection failed', { threadId }, Cause.squash(cause));
            }),
          ),
        ),
      );
    },
  });

  const heldPaths = new Map<string, HeldCount>();
  const releaseCounts = (ids: readonly string[]): void => {
    for (const id of ids) {
      const reading = heldPaths.get(id);
      if (reading !== undefined && !listeners.has(reading.projectId) && !audience.has(id)) heldPaths.delete(id);
    }
  };
  const followed = (row: ThreadSummary): boolean => listeners.has(row.projectId) || audience.has(row.id);

  const counted = (
    rows: readonly ThreadSummary[],
    reading: 'counts' | 'moved' = 'counts',
  ): Effect.Effect<ReadonlyMap<string, ThreadHeld>, HarnessFailure> =>
    Effect.map(heldPathsOf[reading](rows.map((row) => row.id)), (counts) => {
      for (const row of rows) {
        if (!followed(row)) continue;
        heldPaths.set(row.id, { projectId: row.projectId, held: counts.get(row.id) ?? NONE_HELD });
      }
      return counts;
    });

  const withHeld = Effect.fnUntraced(function* (rows: readonly ThreadSummary[]) {
    const unknown = rows.filter((row) => heldPaths.get(row.id)?.held === undefined);
    const watched = unknown.filter(followed);
    if (watched.length > 0) runFork(projectedHeld(recounted(watched)));
    const unfollowed = unknown.filter((row) => !followed(row));
    const counts = unfollowed.length === 0 ? new Map<string, ThreadHeld>() : yield* counted(unfollowed);
    const fresh = new Set(unfollowed.map((row) => row.id));
    return rows.map((row) => (fresh.has(row.id) ? listRow(row, counts.get(row.id) ?? NONE_HELD) : listRow(row)));
  });

  const watchedSummary = Effect.fnUntraced(function* (threadId: string, attention = false) {
    if (listeners.size === 0) return attention ? yield* threads.summary(threadId) : undefined;
    const member = yield* threads.summary(threadId);
    if (member === undefined) return undefined;
    if (followed(member) || (member.parentThreadId !== null && audience.has(member.parentThreadId))) return member;
    const families = yield* threads.families(OPERATOR_PRINCIPAL, member, [...listeners.keys()]);
    let found: ThreadSummary | undefined;
    for (const family of families) {
      audience.include(
        family.projectId,
        family.rows.map((row) => row.id),
      );
      for (const row of family.rows) {
        if (row.id === threadId) found = row;
        else fan(family.projectId, { kind: 'row', row: listRow(row) }, false, false);
      }
    }
    return found ?? (attention ? member : undefined);
  });

  const listRow = (row: ThreadSummary, given?: ThreadHeld): ThreadListProjection => {
    const held = given ?? heldPaths.get(row.id)?.held ?? NONE_HELD;
    return {
      ...row,
      phase: phases.phaseOf(row.id) ?? recordedPhase(row),
      held,
      launchBlocked: gate.blocked(row.id) ? (true as const) : undefined,
    };
  };

  const announce = (row: ThreadSummary, observed = true): ThreadListProjection => {
    const projected = listRow(row);
    const event: ThreadsEvent = row.archivedAt === null ? { kind: 'row', row: projected } : { kind: 'removed', threadId: row.id };
    fan(row.projectId, event, observed);
    const reached = row.parentThreadId === null ? new Set<number>() : audience.projects(row.parentThreadId);
    const prior = [...audience.projects(row.id)];
    for (const projectId of reached) if (projectId !== row.projectId) fan(projectId, event, false, false);
    for (const projectId of prior) {
      if (projectId !== row.projectId && !reached.has(projectId)) fan(projectId, { kind: 'removed', threadId: row.id }, false, false);
    }
    return projected;
  };

  const announceRows = (rows: readonly ThreadSummary[]): void => {
    const ids = new Set(rows.map((row) => row.id));
    const children = new Map<string, ThreadSummary[]>();
    const pending: ThreadSummary[] = [];
    for (const row of rows) {
      if (row.parentThreadId === null || !ids.has(row.parentThreadId)) pending.push(row);
      else {
        const siblings = children.get(row.parentThreadId) ?? [];
        siblings.push(row);
        children.set(row.parentThreadId, siblings);
      }
    }
    for (let index = 0; index < pending.length; index++) {
      const row = pending[index]!;
      announce(row);
      pending.push(...(children.get(row.id) ?? []));
    }
  };

  const recounted = Effect.fnUntraced(function* (rows: readonly ThreadSummary[], reading: 'counts' | 'moved' = 'counts') {
    const shown = new Map(rows.map((row) => [row.id, heldPaths.get(row.id)?.held ?? NONE_HELD] as const));
    yield* counted(rows, reading);
    for (const row of rows) {
      const now = heldPaths.get(row.id)?.held ?? NONE_HELD;
      const was = shown.get(row.id) ?? NONE_HELD;
      if (now.paths === was.paths && now.unproven === was.unproven) continue;
      const current = yield* watchedSummary(row.id);
      if (current !== undefined) announce(current);
    }
  });

  const projectedHeld = (work: Effect.Effect<void, HarnessFailure>): Effect.Effect<void> =>
    Effect.catchCause(work, (cause) =>
      Effect.sync(() => {
        console.error('[tagma] held-path projection failed', Cause.squash(cause));
      }),
    );

  const openWindow = (projectId: number): Effect.Effect<ThreadProjectionWindow, HarnessFailure> =>
    Effect.suspend(() => {
      const opening = audience.opening(projectId, true);
      return Effect.map(threads.rootWindow(OPERATOR_PRINCIPAL, projectId, { limit: LIST_WINDOW_ROWS }), (window) => {
        const opened = { rows: window.rows.map((row) => listRow(row)), roots: window.roots, windowBefore: window.windowBefore };
        releaseCounts(opening.install(window.rows.map((row) => row.id)));
        runFork(projectedHeld(recounted(window.rows)));
        return opened;
      }).pipe(Effect.ensuring(Effect.sync(opening.close)));
    });

  const listWindow = Effect.fnUntraced(function* (projectId: number, before?: Date) {
    const opening = audience.opening(projectId, before === undefined);
    const window = yield* threads.rootWindow(OPERATOR_PRINCIPAL, projectId, { limit: LIST_WINDOW_ROWS, before }).pipe(
      Effect.tap((window) => Effect.sync(() => releaseCounts(opening.install(window.rows.map((row) => row.id))))),
      Effect.ensuring(Effect.sync(opening.close)),
    );
    return { rows: yield* withHeld(window.rows), roots: window.roots, windowBefore: window.windowBefore };
  });

  const recounting = new Map<string, { again: boolean }>();

  const recount = (threadId: string): void => {
    const standing = recounting.get(threadId);
    if (standing !== undefined) {
      standing.again = true;
      return;
    }
    const state = { again: false };
    recounting.set(threadId, state);
    runFork(
      Effect.gen(function* () {
        for (;;) {
          yield* projectedHeld(
            Effect.flatMap(watchedSummary(threadId), (row) => (row === undefined ? Effect.void : recounted([row], 'moved'))),
          );
          if (!state.again) {
            recounting.delete(threadId);
            return;
          }
          state.again = false;
        }
      }).pipe(Effect.onInterrupt(() => Effect.sync(() => recounting.delete(threadId)))),
    );
  };

  const resyncProject = (projectId: number): void => {
    const standing = resyncing.get(projectId);
    if (standing !== undefined) {
      standing.again = true;
      return;
    }
    const reading = { behind: [] as { readonly event: ThreadsEvent; readonly attention: boolean }[], again: false };
    resyncing.set(projectId, reading);
    runFork(
      Effect.exit(openWindow(projectId)).pipe(
        Effect.map((read) => {
          resyncing.delete(projectId);
          if (Exit.isSuccess(read)) {
            const window = read.value;
            deliver(projectId, { kind: 'list', rows: window.rows, roots: window.roots, windowBefore: window.windowBefore });
          } else {
            console.error('[tagma] thread list resync failed', { projectId }, Cause.squash(read.cause));
          }
          for (const { event, attention } of reading.behind) deliver(projectId, event, attention);
          if (reading.again) resyncProject(projectId);
        }),
      ),
    );
  };

  const resync = (only?: number): void => {
    for (const projectId of only === undefined ? listeners.keys() : listeners.has(only) ? [only] : []) resyncProject(projectId);
    for (const listener of everyone) listener({ kind: 'resync' });
  };

  const attentionMoved = (state: NativeThreadState): boolean => {
    if (everyone.size === 0 || state.thread.ownerId !== OPERATOR_PRINCIPAL) return false;
    const signal = standingSignal(state);
    if (signals.get(state.thread.id) === signal) return false;
    signals.set(state.thread.id, signal);
    return true;
  };

  const announceThread = (threadId: string, projectId?: number) =>
    Effect.suspend(() => {
      if (unwatched()) return Effect.void;
      return watchedSummary(threadId, everyone.size > 0).pipe(
        Effect.map((row) => {
          if (row !== undefined) announce(row);
        }),
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            console.error('[tagma] thread list projection failed', { threadId }, Cause.squash(cause));
            resync();
          }),
        ),
      );
    });

  const detachBirths = records.birthRecorded(({ threadId, projectId }) => announceThread(threadId, projectId));
  const removeRow = (threadId: string, projectId: number): void => {
    const reached = [...audience.projects(threadId)];
    fan(projectId, { kind: 'removed', threadId });
    for (const target of reached) if (target !== projectId) fan(target, { kind: 'removed', threadId }, false, false);
  };
  const removedRows = Effect.fnUntraced(function* (ids: readonly string[]) {
    const homes = yield* records.projectsOf(ids);
    for (const id of ids) {
      const home = homes.get(id);
      if (home !== undefined && home !== null) removeRow(id, home);
    }
  });
  const detachRemovals = records.removalRecorded(({ threadId, projectId }) => Effect.sync(() => removeRow(threadId, projectId)));
  const detach = live.subscribeStates((state) => {
    phases.follow(state.thread.id, state.activeRun?.id ?? null);
    const moved = attentionMoved(state);
    if (listeners.size === 0 && !moved) return;
    runFork(
      watchedSummary(state.thread.id, moved).pipe(
        Effect.map((row) => {
          if (row !== undefined) announce(row, false);
        }),
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            console.error('[tagma] thread list projection failed', { threadId: state.thread.id }, Cause.squash(cause));
            resync();
          }),
        ),
      ),
    );
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      detachBirths();
      detachRemovals();
      detach();
      phases.dispose();
    }),
  );

  return ThreadList.of({
    attention: () => threads.attention(OPERATOR_PRINCIPAL),
    pulse: () => threads.pulse(OPERATOR_PRINCIPAL),

    observe: (threadId, notify) => {
      const held = observers.get(threadId) ?? new Set();
      held.add(notify);
      observers.set(threadId, held);
      return () => {
        held.delete(notify);
        if (held.size === 0 && observers.get(threadId) === held) observers.delete(threadId);
      };
    },

    subscribeAttention: (listener) => {
      everyone.add(listener);
      return () => {
        everyone.delete(listener);
        if (everyone.size === 0) signals.clear();
      };
    },

    list: (projectId, selection) =>
      admitThreadFailures(
        Effect.gen(function* () {
          const page = yield* threads.list(OPERATOR_PRINCIPAL, projectId, selection);
          return { rows: yield* withHeld(page.rows), total: page.total, before: page.before };
        }),
        THREAD_OPERATIONS.list_threads.refusals,
      ),

    listWindow,

    row: Effect.fnUntraced(function* (threadId) {
      const row = yield* threads.summary(threadId);
      if (row === undefined) return undefined;
      return (yield* withHeld([row]))[0];
    }),

    subscribe: (projectId, listener) => {
      const held = listeners.get(projectId) ?? new Set();
      held.add(listener);
      listeners.set(projectId, held);
      audience.watch(projectId);
      return () => {
        held.delete(listener);
        if (held.size === 0 && listeners.get(projectId) === held) {
          listeners.delete(projectId);
          releaseCounts(audience.close(projectId));
        }
      };
    },

    announce,

    announceThread,

    announceFolders: (projectId, folders) => fan(projectId, { kind: 'folders', folders }),

    resync,

    markHeld: (threadId) =>
      Effect.sync(() => {
        if (listeners.size > 0) recount(threadId);
      }),

    openWindow,

    relation: (threadId, callerId) => records.relation(threadId, callerId),

    working: (threadId) => Effect.map(threads.heldSessionsInSubtree(threadId), (rows) => [...new Set(rows.map((row) => row.threadId))]),

    sweepRelation: (projectId, selection, archived, callerId) =>
      Effect.map(
        threads.selectsBeyond(OPERATOR_PRINCIPAL, projectId, { ...selection, view: archived ? 'live' : 'archived' }, callerId),
        (beyond) => (beyond ? ('beyond' as const) : ('subtree' as const)),
      ),

    serveOpenCalls: (read) => {
      openCalls = read;
      return () => {
        if (openCalls === read) openCalls = null;
      };
    },

    serveArchiving: (work) => {
      archiving = work;
      return () => {
        if (archiving === work) archiving = null;
      };
    },

    setArchived: (threadId, projectId, archived, spared = null) =>
      admitThreadFailures(
        gated(
          records,
          threadId,
          projectId,
          Effect.fnUntraced(function* () {
            const stamp = threads.setArchived(threadId, archived ? new Date(yield* Clock.currentTimeMillis) : null);
            let moved: readonly string[];
            if (archived) {
              const ending = yield* records.subtree(threadId, undefined, spared);
              moved = yield* closeWork(
                ending,
                Effect.fnUntraced(function* (close) {
                  yield* close(ending);
                  const targets = new Set<string>(ending);
                  const held = yield* threads.heldSessionsInSubtree(threadId);
                  for (const id of new Set(held.map((row) => row.threadId))) {
                    if (targets.has(id)) yield* releasing.release(id);
                  }
                  return yield* stamp;
                }),
              );
            } else moved = yield* stamp;
            const row = yield* threads.summary(threadId);
            if (row === undefined) return yield* Effect.fail(new ThreadWriteConflict(threadId));
            for (const id of moved) yield* rollouts.appendMeta(id);
            if (archived) {
              yield* removedRows(moved);
              rollouts.shelve(moved);
            } else {
              announceRows(yield* threads.summaries(moved));
            }
            return listRow(row);
          }),
        ),
        THREAD_OPERATIONS.archive_thread.refusals,
      ),

    setArchivedMatching: (projectId, selection, archived, by) =>
      admitThreadFailures(
        Effect.gen(function* () {
          const spared = archived ? lineageOf(by) : null;
          const before: ArchiveWork = (ids, work) =>
            closeWork(ids, (close) =>
              work(
                Effect.fnUntraced(function* (selected) {
                  yield* close(selected);
                  const held = yield* threads.heldUpMatching(OPERATOR_PRINCIPAL, projectId, { ...selection, view: 'live' }, spared);
                  const targets = new Set(selected);
                  for (const id of new Set(held.map((row) => row.sessionThreadId))) {
                    if (targets.has(id)) yield* releasing.release(id);
                  }
                }),
              ),
            );
          const swept = yield* threads.setArchivedWhere(
            OPERATOR_PRINCIPAL,
            projectId,
            { ...selection, view: archived ? 'live' : 'archived' },
            archived ? new Date(yield* Clock.currentTimeMillis) : null,
            spared,
            archived ? before : undefined,
          );
          for (const id of swept.moved) yield* rollouts.appendMeta(id);
          if (archived) {
            yield* removedRows(swept.moved);
            rollouts.shelve(swept.moved);
          } else {
            announceRows(yield* threads.summaries(swept.moved));
          }
          return swept;
        }),
        THREAD_OPERATIONS.archive_threads.refusals,
      ),

    setPinned: (threadId, projectId, pinned) =>
      admitThreadFailures(
        gated(
          records,
          threadId,
          projectId,
          Effect.fnUntraced(function* () {
            const held = yield* threads.setPinned(threadId, pinned ? new Date(yield* Clock.currentTimeMillis) : null);
            if (held === undefined) return yield* Effect.fail(new ThreadWriteConflict(threadId));
            yield* rollouts.appendMeta(held);
            const row = yield* threads.summary(held);
            if (row === undefined) return yield* Effect.fail(new ThreadNotFoundError(held));
            return announce(row);
          }),
        ),
        THREAD_OPERATIONS.pin_thread.refusals,
      ),

    see: (threadId, projectId, runId) =>
      gated(
        records,
        threadId,
        projectId,
        Effect.fnUntraced(function* () {
          const row = yield* threads.see(threadId, runId);
          if (row === undefined) return yield* Effect.fail(new ThreadWriteConflict(threadId));
          return announce(row);
        }),
      ),
  });
});
