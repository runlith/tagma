import { Cause, Clock, Deferred, Duration, Effect, FiberSet, Schedule } from 'effect';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import type { SelectionRow } from '../../platform/contract/service/projections.js';
import { rowCursor } from '../../platform/store/rows.js';
import { RowBuffer } from '../../platform/store/rowBuffer.js';
import { recordRows } from '../../thread-record/store/table.js';
import { nativeRows, runRows } from '../store/kernel.js';
import { seenRows } from '../store/tables.js';
import { mandateRows, spellRows } from '../store/mandate.js';
import { sessionFacts } from '../store/harnessFacet.js';
import { placementRows } from '../../workspace/store/tables.js';
import {
  type ThreadActivity,
  type ThreadAncestry,
  type ThreadLineage,
  type ThreadRetainer,
  type ThreadRowBatch,
  type ThreadRowChange,
  type ThreadRowRemoved,
  ThreadRows,
} from '../contract/service/rows.js';
import {
  activityInput,
  ancestryInput,
  heldRows,
  latestInput,
  narrowRows,
  outcomeInput,
  owingInput,
  placeInput,
  recapInput,
} from './inputs.js';
import { summaryOf, type ThreadSummary } from './summary.js';
import { activeOf, heldOf, rowOf, type HeldBirth, type HeldRow } from './held.js';

type RowCommit = Parameters<Parameters<MachineStore['Service']['rows']['listen']>[0]>[0];
type Complete = Extract<RowCommit, { readonly _tag: 'Complete' }>;
type Activity = SelectionRow<typeof activityInput.columns>;
type Outcome = SelectionRow<typeof outcomeInput.columns>;
type Latest = SelectionRow<typeof latestInput.columns>;

const activityOf = (selected: Activity): ThreadActivity | null =>
  selected.runId === null
    ? null
    : {
        threadId: selected.threadId,
        projectId: selected.projectId,
        parentThreadId: selected.parentId,
        rootId: selected.rootId,
        runId: selected.runId,
      };

const sameActivity = (left: ThreadActivity | undefined, right: ThreadActivity | null): boolean =>
  left === undefined
    ? right === null
    : right !== null &&
      left.runId === right.runId &&
      left.rootId === right.rootId &&
      left.projectId === right.projectId &&
      left.parentThreadId === right.parentThreadId;

const PATCHED_RUN = {
  status: 'runStatus',
  progress: 'progress',
  resumes: 'resumes',
  heartbeatAt: 'heartbeatAt',
  startedAt: 'startedAt',
  handedOverAt: 'handedOverAt',
  provider: 'runProvider',
  model: 'runModel',
  reasoning: 'runReasoning',
  saidLive: 'saidLive',
} as const;

export const makeThreadRows = Effect.gen(function* () {
  const store = yield* MachineStore;
  const { db } = store;
  const units = yield* MachineUnits;
  const kinds = yield* ThreadEntryKinds;
  const clock = yield* Clock.Clock;
  const fork = yield* FiberSet.makeRuntime<never, void, never>();

  let cursor = 0;
  let live = false;
  let again = false;
  let waiting: RowCommit[] = [];
  let ready = yield* Deferred.make<void>();
  const recent = new RowBuffer();
  const held = new Map<string, HeldRow>();
  const activity = new Map<string, ThreadActivity>();
  const owed = new Set<string>();
  const paths = new Map<string, ThreadAncestry>();
  const retainers = new Set<ThreadRetainer>();
  const listeners = new Set<(batch: ThreadRowBatch) => void>();
  const hydrating = new Set<string>();

  const waitingSet = (): Set<string> => {
    const found = new Set<string>();
    for (const id of activity.keys()) for (const entry of (paths.get(id) ?? []).slice(1)) found.add(entry.id);
    for (const id of owed) for (const entry of paths.get(id) ?? [{ id }]) found.add(entry.id);
    return found;
  };
  let waits = new Set<string>();

  const summaryOfHeld = (entry: HeldRow): ThreadSummary | undefined => {
    try {
      const summary = summaryOf(kinds, rowOf(entry), true, new Date(clock.currentTimeMillisUnsafe()));
      return summary.activeRun === null && entry.owing ? { ...summary, owes: true } : summary;
    } catch (cause) {
      console.error('[tagma] a held thread row could not be summarized', { threadId: entry.record.id }, cause);
      return undefined;
    }
  };

  const keeps = (id: string, summary: ThreadSummary | undefined): boolean =>
    waits.has(id) || (summary !== undefined && [...retainers].some((retainer) => retainer.keeps(summary)));

  const wants = (place: ThreadLineage): boolean => waits.has(place.threadId) || [...retainers].some((retainer) => retainer.wants(place));

  const emit = (batch: ThreadRowBatch): void => {
    if (batch.rows.length === 0 && batch.removed.length === 0 && !batch.activity && !batch.reset) return;
    for (const listener of listeners) {
      try {
        listener(batch);
      } catch (cause) {
        console.error('[tagma] a thread row listener threw', cause);
      }
    }
  };

  const patchPaths = (id: string, patch: (entry: ThreadAncestry[number]) => ThreadAncestry[number], touched?: Map<string, boolean>) => {
    const repath = (path: ThreadAncestry) =>
      path.some((entry) => entry.id === id) ? path.map((entry) => (entry.id === id ? patch(entry) : entry)) : path;
    for (const [threadId, entry] of held) {
      const next = repath(entry.ancestry);
      if (next !== entry.ancestry) {
        entry.ancestry = next;
        touched?.set(threadId, true);
      }
    }
    for (const [threadId, path] of paths) paths.set(threadId, repath(path));
  };

  const splice = (id: string, path: ThreadAncestry, touched?: Map<string, boolean>) => {
    const repath = (standing: ThreadAncestry) => {
      const at = standing.findIndex((entry) => entry.id === id);
      return at <= 0 ? standing : [...standing.slice(0, at), ...path];
    };
    for (const [threadId, entry] of held) {
      const next = repath(entry.ancestry);
      if (next !== entry.ancestry) {
        entry.ancestry = next;
        touched?.set(threadId, true);
      }
    }
    for (const [threadId, standing] of paths) paths.set(threadId, repath(standing));
  };

  const apply = (commit: Complete, only?: ReadonlySet<string>) => {
    const touched = new Map<string, boolean>();
    const removed: ThreadRowRemoved[] = [];
    const births = new Map<string, HeldBirth>();
    const places = new Map<string, ThreadLineage>();
    let moved = false;
    let grouped = false;
    const own = (id: string): HeldRow | undefined => {
      if (only !== undefined && !only.has(id)) return undefined;
      const entry = held.get(id);
      return entry !== undefined && entry.at < commit.cursor ? entry : undefined;
    };
    const touch = (id: string, observed: boolean) => touched.set(id, (touched.get(id) ?? false) || observed);
    const place = (id: string, given: Partial<ThreadLineage>) => {
      const standing = places.get(id) ?? { threadId: id, home: null, parentThreadId: null, principal: null, ancestry: [] };
      places.set(id, {
        threadId: id,
        home: standing.home ?? given.home ?? null,
        parentThreadId: standing.parentThreadId ?? given.parentThreadId ?? null,
        principal: standing.principal ?? given.principal ?? null,
        ancestry: standing.ancestry.length > 0 ? standing.ancestry : (given.ancestry ?? []),
      });
    };
    const birth = (id: string): HeldBirth => {
      const standing = births.get(id) ?? {};
      births.set(id, standing);
      return standing;
    };
    for (const change of commit.changes) {
      const record = recordRows.fact(change);
      if (record !== undefined) {
        const id = record.key.id;
        const entry = own(id);
        if (record.kind === 'delete') {
          if (only === undefined) {
            removed.push({ threadId: id, projectId: record.values.projectId ?? null, parentThreadId: record.values.parentId ?? null });
            if (paths.delete(id)) grouped = true;
            if (activity.delete(id)) moved = true;
            if (owed.delete(id)) grouped = true;
          }
          if (entry !== undefined) held.delete(id);
          touched.delete(id);
          continue;
        }
        if (entry !== undefined) {
          Object.assign(entry.record, record.values);
          touch(id, true);
        } else if (only === undefined && !held.has(id)) {
          if (record.kind === 'insert') birth(id).record = record.values;
          place(id, {
            home: record.values.projectId ?? null,
            parentThreadId: record.values.parentId ?? null,
            principal: record.values.principalId ?? null,
          });
        }
        const values = record.values;
        if ('archivedAt' in values || 'projectId' in values || 'parentId' in values || 'principalId' in values)
          patchPaths(
            id,
            (standing) => ({
              ...standing,
              home: values.projectId === undefined ? standing.home : values.projectId,
              parent: values.parentId === undefined ? standing.parent : values.parentId,
              principal: values.principalId ?? standing.principal,
              archived: values.archivedAt === undefined ? standing.archived : (values.archivedAt?.getTime() ?? null),
            }),
            touched,
          );
        continue;
      }
      const native = nativeRows.fact(change);
      if (native !== undefined) {
        const entry = own(native.key.id);
        if (entry !== undefined && native.kind !== 'delete') {
          Object.assign(entry.native, native.values);
          touch(native.key.id, true);
        } else if (only === undefined && native.kind === 'insert') birth(native.key.id).native = native.values;
        continue;
      }
      const mandate = mandateRows.fact(change);
      if (mandate !== undefined) {
        const entry = own(mandate.key.id);
        if (entry !== undefined && mandate.kind !== 'delete') {
          Object.assign(entry.mandate, mandate.values);
          touch(mandate.key.id, true);
        } else if (only === undefined && mandate.kind === 'insert') birth(mandate.key.id).mandate = mandate.values;
        continue;
      }
      const session = sessionFacts.fact(change);
      if (session !== undefined) {
        const entry = own(session.key.id);
        if (entry !== undefined) {
          entry.facet = session.kind === 'delete' ? null : (session.values.facet ?? entry.facet);
          touch(session.key.id, true);
        } else if (only === undefined && session.kind === 'insert') birth(session.key.id).facet = session.values.facet;
        continue;
      }
      const seen = seenRows.fact(change);
      if (seen !== undefined) {
        const entry = own(seen.key.threadId);
        if (entry !== undefined) {
          entry.seen = seen.kind === 'delete' ? null : (seen.values.runId ?? entry.seen);
          touch(seen.key.threadId, true);
        }
        continue;
      }
      const placed = placementRows.fact(change);
      if (placed !== undefined) {
        const entry = own(placed.key.threadId);
        if (entry !== undefined) {
          entry.root = placed.kind === 'delete' ? null : placed.values.rootId === undefined ? entry.root : placed.values.rootId;
          touch(placed.key.threadId, true);
        } else if (only === undefined && placed.kind === 'insert') birth(placed.key.threadId).root = placed.values.rootId;
        continue;
      }
      const spell = spellRows.fact(change);
      if (spell !== undefined) {
        const startedAt = spell.kind === 'delete' ? null : (spell.values.startedAt?.getTime() ?? null);
        patchPaths(spell.key.threadId, (standing) => ({ ...standing, spell: startedAt }), touched);
        continue;
      }
      const run = runRows.fact(change);
      if (run !== undefined && run.kind === 'update' && typeof change.address === 'string') {
        const entry = own(change.address);
        if (entry?.active === null || entry?.active?.runId !== run.key.id) continue;
        const active = entry.active as Record<string, unknown>;
        const patched = Object.entries(run.values).flatMap(([field, value]) => {
          const target = PATCHED_RUN[field as keyof typeof PATCHED_RUN];
          return target === undefined ? [] : [[target, value] as const];
        });
        if (patched.length === 0) continue;
        const beat = patched.every(([target]) => target === 'heartbeatAt');
        const life = beat ? summaryOfHeld(entry)?.life : undefined;
        for (const [target, value] of patched) active[target] = value;
        if (beat && summaryOfHeld(entry)?.life === life) continue;
        touch(change.address, false);
      }
    }
    for (const selected of commit.selected) {
      if (typeof selected.key !== 'string') continue;
      const id = selected.key;
      const entry = own(id);
      const activitySelected = activityInput.value(selected);
      if (activitySelected !== undefined) {
        if (only === undefined && activitySelected !== null) {
          const next = activityOf(activitySelected);
          if (!sameActivity(activity.get(id), next)) moved = true;
          if (next === null) activity.delete(id);
          else activity.set(id, next);
          if (!held.has(id)) place(id, { home: activitySelected.projectId, parentThreadId: activitySelected.parentId });
        }
        if (entry !== undefined) {
          entry.active = activeOf(activitySelected);
          if (activitySelected !== null) entry.root = activitySelected.rootId;
          touch(id, false);
        }
        continue;
      }
      const ancestry = ancestryInput.value(selected);
      if (ancestry !== undefined) {
        const path = ancestry?.path ?? [];
        if (only === undefined) {
          paths.set(id, path);
          splice(id, path, touched);
          grouped = true;
          if (!held.has(id) && path.length > 0)
            place(id, { home: path[0]!.home, parentThreadId: path[0]!.parent, principal: path[0]!.principal, ancestry: path });
        }
        if (entry !== undefined) {
          entry.ancestry = path;
          touch(id, false);
        }
        continue;
      }
      const owing = owingInput.value(selected);
      if (owing !== undefined) {
        if (only === undefined && owed.has(id) !== (owing?.owing === true)) {
          if (owing?.owing === true) owed.add(id);
          else owed.delete(id);
          grouped = true;
        }
        if (entry !== undefined) {
          entry.owing = owing?.owing === true;
          touch(id, false);
        }
        continue;
      }
      const outcome = outcomeInput.value(selected);
      if (outcome !== undefined) {
        if (entry !== undefined) {
          entry.outcome = outcome;
          touch(id, false);
        }
        continue;
      }
      const latest = latestInput.value(selected);
      if (latest !== undefined) {
        if (entry !== undefined) {
          entry.latest = latest;
          touch(id, false);
        }
        continue;
      }
      const recap = recapInput.value(selected);
      if (recap !== undefined) {
        if (entry !== undefined) {
          entry.appeared = recap?.appeared ?? null;
          touch(id, false);
        }
        continue;
      }
      const located = placeInput.value(selected);
      if (located !== undefined && located !== null && !held.has(id))
        place(id, { home: located.home, parentThreadId: located.parent, principal: located.principal });
    }
    grouped ||= moved;
    if (grouped) for (const id of [...paths.keys()]) if (!activity.has(id) && !owed.has(id)) paths.delete(id);
    return { touched, removed, births, places, moved, grouped };
  };

  const born = (commit: Complete, id: string, birth: HeldBirth): HeldRow | undefined => {
    if (birth.record === undefined || birth.native === undefined || birth.mandate === undefined || birth.record.projectId === null)
      return undefined;
    const selected = (input: { readonly value: (row: Complete['selected'][number]) => unknown }) =>
      commit.selected
        .filter((row) => row.key === id)
        .map((row) => input.value(row))
        .find((value) => value !== undefined);
    const ancestry = selected(ancestryInput) as SelectionRow<typeof ancestryInput.columns> | null | undefined;
    return {
      at: commit.cursor,
      record: birth.record,
      native: birth.native,
      mandate: birth.mandate,
      facet: birth.facet ?? null,
      seen: null,
      root: birth.root ?? null,
      active: activeOf((selected(activityInput) as Activity | null | undefined) ?? null),
      outcome: (selected(outcomeInput) as Outcome | null | undefined) ?? null,
      latest: (selected(latestInput) as Latest | null | undefined) ?? null,
      appeared: (selected(recapInput) as { appeared: number | null } | null | undefined)?.appeared ?? null,
      owing: (selected(owingInput) as { owing: boolean } | null | undefined)?.owing === true,
      ancestry: ancestry?.path ?? [],
    };
  };

  const changed = (touched: ReadonlyMap<string, boolean>): ThreadRowChange[] => {
    const rows: ThreadRowChange[] = [];
    for (const [id, observed] of touched) {
      const entry = held.get(id);
      if (entry === undefined) continue;
      const summary = entry.record.projectId === null ? undefined : summaryOfHeld(entry);
      if (summary !== undefined) rows.push({ summary, observed });
      if (!keeps(id, summary)) held.delete(id);
    }
    return rows;
  };

  const install = (at: number, rows: Effect.Success<ReturnType<typeof heldRows>>): 'stale' | ThreadRowChange[] => {
    const replay = recent.after(at);
    if (replay === null) return 'stale';
    const only = new Set<string>();
    for (const row of rows) {
      const standing = held.get(row.record.id);
      if (standing !== undefined && standing.at >= at) continue;
      held.set(row.record.id, heldOf(row, at));
      only.add(row.record.id);
    }
    const touched = new Map<string, boolean>([...only].map((id) => [id, true]));
    for (const commit of replay) if (commit._tag === 'Complete') apply(commit, only);
    return changed(touched);
  };

  const hydrated = Effect.fnUntraced(
    function* (ids: readonly string[], told: boolean) {
      for (;;) {
        yield* Deferred.await(ready);
        const cut = yield* units.read(
          (unit) =>
            Effect.gen(function* () {
              const at = yield* rowCursor(db, unit);
              return { at, rows: yield* heldRows(db, unit, ids) };
            }),
          { snapshot: true },
        );
        if (!live) continue;
        const rows = install(cut.at, cut.rows);
        if (rows === 'stale') continue;
        if (told) emit({ rows, removed: [], activity: false, reset: false });
        return rows.map((row) => row.summary);
      }
    },
    (effect, ids) =>
      Effect.ensuring(
        effect,
        Effect.sync(() => ids.forEach((id) => hydrating.delete(id))),
      ),
  );

  const hydrate = (ids: readonly string[]): void => {
    const fresh = ids.filter((id) => !held.has(id) && !hydrating.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) hydrating.add(id);
    fork(
      hydrated(fresh, true).pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            console.error('[tagma] thread rows could not be hydrated; they recover from a fresh cut', { ids: fresh }, Cause.squash(cause));
            restart();
          }),
        ),
      ),
    );
  };

  const settle = (commit: Complete): void => {
    const applied = apply(commit);
    recent.push(commit);
    cursor = commit.cursor;
    const rows = changed(applied.touched);
    const pending: string[] = [];
    for (const [id, birth] of applied.births) {
      const place = applied.places.get(id);
      if (place === undefined || !wants(place)) continue;
      const entry = born(commit, id, birth);
      if (entry === undefined) pending.push(id);
      else {
        held.set(id, entry);
        rows.push(...changed(new Map([[id, true]])));
      }
    }
    for (const [id, place] of applied.places) if (!held.has(id) && !applied.births.has(id) && wants(place)) pending.push(id);
    const next = applied.grouped ? waitingSet() : waits;
    if (next !== waits) for (const id of next) if (!waits.has(id) && !held.has(id)) pending.push(id);
    const left = next === waits ? [] : [...waits].filter((id) => !next.has(id));
    waits = next;
    emit({ rows, removed: applied.removed, activity: applied.moved, reset: false });
    for (const id of left) {
      const entry = held.get(id);
      if (entry !== undefined && !keeps(id, summaryOfHeld(entry))) held.delete(id);
    }
    hydrate(pending);
  };

  const restart = (): void => {
    if (!live) {
      again = true;
      return;
    }
    live = false;
    waiting = [];
    ready = Deferred.makeUnsafe<void>();
    fork(recovering);
  };

  const listen = (commit: RowCommit): void => {
    if (!live) {
      waiting.push(commit);
      if (waiting.length > 64 || commit._tag === 'Gap') {
        waiting = [];
        again = true;
      }
      return;
    }
    if (commit.cursor <= cursor) return;
    if (commit._tag === 'Gap' || commit.cursor !== cursor + 1) {
      recent.clear(commit.cursor);
      restart();
      return;
    }
    settle(commit);
  };

  const recovered = Effect.gen(function* () {
    for (;;) {
      again = false;
      const ids = [...held.keys()];
      const cut = yield* units.read(
        (unit) =>
          Effect.gen(function* () {
            const at = yield* rowCursor(db, unit);
            const narrow = yield* narrowRows(db, unit);
            const rows = ids.length === 0 ? [] : yield* heldRows(db, unit, ids);
            return { at, narrow, rows };
          }),
        { snapshot: true },
      );
      if (again) continue;
      activity.clear();
      owed.clear();
      paths.clear();
      held.clear();
      for (const row of cut.narrow) {
        const running = row.activity === null ? null : activityOf(row.activity);
        if (running !== null) activity.set(row.id, running);
        if (row.owing?.owing === true) owed.add(row.id);
        if (running !== null || row.owing?.owing === true) paths.set(row.id, row.ancestry?.path ?? []);
      }
      for (const row of cut.rows) held.set(row.record.id, heldOf(row, cut.at));
      cursor = cut.at;
      recent.clear(cut.at);
      const queued = waiting.filter((commit) => commit.cursor > cut.at);
      waiting = [];
      live = true;
      waits = waitingSet();
      let continuous = true;
      for (const commit of queued) {
        if (commit._tag === 'Gap' || commit.cursor !== cursor + 1) {
          continuous = false;
          break;
        }
        apply(commit);
        recent.push(commit);
        cursor = commit.cursor;
      }
      if (!continuous) {
        live = false;
        continue;
      }
      waits = waitingSet();
      yield* Deferred.succeed(ready, undefined);
      emit({ rows: changed(new Map([...held.keys()].map((id) => [id, true]))), removed: [], activity: true, reset: true });
      hydrate([...waits]);
      return;
    }
  });
  const recovering = recovered.pipe(
    Effect.tapError((failure) => Effect.logWarning('thread rows could not be recovered; trying again', { failure })),
    Effect.retry(Schedule.spaced(Duration.seconds(1))),
    Effect.orDie,
  );

  const detach = store.rows.listen(listen);
  yield* Effect.addFinalizer(() => Effect.sync(detach));
  yield* Effect.orDie(recovered);
  if (!live) return yield* Effect.die(new Error('thread rows could not take their first cut'));

  return ThreadRows.of({
    current: (id) => {
      const entry = held.get(id);
      return entry === undefined || entry.record.projectId === null ? undefined : summaryOfHeld(entry);
    },
    latest: (id) => {
      const latest = held.get(id)?.latest ?? null;
      return latest === null ? null : { runId: latest.id, status: latest.status, pingId: latest.pingId, pingAt: latest.pingAt };
    },
    readIn: Effect.fn('ThreadRows.readIn')(function* (unit, ids) {
      const absent = ids.filter((id) => !held.has(id));
      const fresh = new Map<string, ThreadSummary>();
      if (absent.length > 0) {
        const at = yield* rowCursor(db, unit);
        const rows = yield* heldRows(db, unit, absent);
        const installed = live ? install(at, rows) : 'stale';
        const summaries =
          installed === 'stale' ? rows.flatMap((row) => summaryOfHeld(heldOf(row, at)) ?? []) : installed.map((row) => row.summary);
        for (const summary of summaries) fresh.set(summary.id, summary);
      }
      return ids.flatMap((id) => {
        const entry = held.get(id);
        const summary = entry === undefined || entry.record.projectId === null ? fresh.get(id) : summaryOfHeld(entry);
        return summary === undefined ? [] : [summary];
      });
    }),
    read: Effect.fn('ThreadRows.read')(function* (ids) {
      yield* Deferred.await(ready);
      const absent = ids.filter((id) => !held.has(id));
      const fresh = new Map((absent.length === 0 ? [] : yield* hydrated(absent, false)).map((summary) => [summary.id, summary]));
      return ids.flatMap((id) => {
        const entry = held.get(id);
        const summary = entry === undefined || entry.record.projectId === null ? fresh.get(id) : summaryOfHeld(entry);
        return summary === undefined ? [] : [summary];
      });
    }),
    retain: (retainer) => {
      retainers.add(retainer);
      return () => void retainers.delete(retainer);
    },
    release: (ids) => {
      for (const id of ids) {
        const entry = held.get(id);
        if (entry !== undefined && !keeps(id, summaryOfHeld(entry))) held.delete(id);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    activities: () => activity,
    waiting: (id) => {
      let parentThreadId: string | null | undefined = held.get(id)?.record.parentId;
      let waitsBelow = false;
      let owing = false;
      for (const [threadId, path] of paths) {
        const at = path.findIndex((entry) => entry.id === id);
        if (at < 0) continue;
        parentThreadId ??= path[at]!.parent;
        if (at > 0 && activity.has(threadId)) waitsBelow = true;
        if (owed.has(threadId)) owing = true;
      }
      if (owed.has(id)) owing = true;
      return parentThreadId === undefined ? null : { parentThreadId, waits: waitsBelow, owing };
    },
    waitingIds: () => [...waits],
    owing: (ids) => Effect.map(Deferred.await(ready), () => (ids === undefined ? [...owed] : ids.filter((id) => owed.has(id)))),
  });
});
