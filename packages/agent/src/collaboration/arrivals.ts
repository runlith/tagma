import { Clock, type Context, Effect, Option } from 'effect';
import type { ThreadRecord } from '../thread/record';
import type { ThreadInbox } from '../thread/ThreadPorts';
import type { ThreadAnswer, ThreadInboxItem } from '../thread/storage/inbox';
import type { ThreadDirectory, ThreadDirectoryAssignment } from './ThreadDirectory';
import type { ThreadEnvelopeSender } from './ThreadEnvelopes';
import { threadFinalEnvelopeId } from './ThreadObligations';
import type { ThreadPlaneFailure } from './ThreadPlaneAccess';
import type { Threads } from './threads';
export type ThreadReportKind = 'final' | 'end';
type StandingArrival = Extract<
  ThreadInboxItem,
  {
    kind: 'envelope' | 'task';
  }
>;
export type ThreadWaitArrival = {
  readonly from: string | null;
  readonly intent: 'message' | 'task' | 'report' | 'interrupt' | 'approval';
  readonly envelopeId: string;
  readonly text: string;
  readonly report: ThreadReportKind | null;
  readonly answer: ThreadAnswer | null;
};
export type ThreadWaitEnding = Exclude<ThreadDirectoryAssignment, 'never-started' | 'running'> | 'archived';
export type ThreadWaitResult = {
  readonly arrived: readonly ThreadWaitArrival[];
  readonly others: readonly ThreadWaitArrival[];
  readonly silent: readonly string[];
  readonly ended: readonly {
    readonly address: string;
    readonly ending: ThreadWaitEnding;
  }[];
  readonly unknown: readonly string[];
  readonly expired: boolean;
};
export type ThreadWaitAsk = {
  readonly from: readonly string[];
  readonly deadlineMs: number;
  readonly since: Date;
  readonly read?: ReadonlySet<string>;
};
const ENDINGS: ReadonlySet<ThreadDirectoryAssignment> = new Set(['completed', 'failed', 'aborted', 'cut']);
export function reportKindOf(envelopeId: string): ThreadReportKind {
  return envelopeId.startsWith(threadFinalEnvelopeId('')) ? 'final' : 'end';
}
type Watched = {
  readonly named: ReadonlyMap<string, string>;
  readonly namedIds: ReadonlySet<string>;
  readonly unknown: readonly string[];
  readonly endings: Map<string, ThreadWaitEnding>;
  readonly waitable: Set<string>;
  readonly read: Set<string>;
  readonly now: number;
  readonly until: number;
};
type Verdict<A> = Effect.Effect<A | null, ThreadPlaneFailure>;
function watching<A>(
  threads: Context.Service.Shape<typeof Threads>,
  directory: Context.Service.Shape<typeof ThreadDirectory>,
  inbox: Context.Service.Shape<typeof ThreadInbox>,
  reconcileMs: number,
  waiter: ThreadEnvelopeSender,
  ask: ThreadWaitAsk,
  targets: readonly (ThreadRecord | null)[],
  judge: (
    watched: Watched,
    rows: readonly StandingArrival[],
    dropped: (id: string) => void,
    latest: Effect.Effect<readonly StandingArrival[], ThreadPlaneFailure>,
  ) => Verdict<A>,
  reports?: 'all',
): Effect.Effect<A, ThreadPlaneFailure> {
  return Effect.scoped(
    Effect.gen(function* () {
      const named = new Map(ask.from.map((address, index) => [targets[index]?.id ?? address, address]));
      const namedIds = new Set(targets.flatMap((target) => (target ? [target.id] : [])));
      const unknown = ask.from.filter((_, index) => targets[index] === null);
      const read = new Set(ask.read ?? []);
      const endings = new Map<string, ThreadWaitEnding>();
      const waitable = new Set<string>();
      const until = (yield* Clock.currentTimeMillis) + ask.deadlineMs;
      const moved = yield* threads.watch([waiter.id, ...namedIds]);
      const dropped = new Set<string>();
      const settle = Effect.fnUntraced(function* (ids: readonly string[]) {
        const live = ids.filter((id) => !dropped.has(id));
        if (live.length === 0) return;
        const page = yield* directory.access(waiter).list({ ids: live, limit: live.length });
        const entries = new Map(page.rows.map((entry) => [entry.threadId, entry] as const));
        for (const id of live) {
          const entry = entries.get(id);
          const ending: ThreadWaitEnding | null = !entry
            ? 'archived'
            : ENDINGS.has(entry.assignment)
              ? (entry.assignment as ThreadWaitEnding)
              : null;
          if (ending === null) endings.delete(id);
          else endings.set(id, ending);
          if (ending === null && (entry?.life === 'working' || entry?.life === 'awaiting')) waitable.add(id);
          else waitable.delete(id);
        }
      });
      const cursor: {
        through: number | null;
      } = { through: null };
      const standing = Effect.suspend(() =>
        Effect.map(inbox.arrivals({ threadId: waiter.id, after: cursor.through, reports }), ({ items, through }) => {
          cursor.through = through;
          return items.flatMap((item) =>
            (item.kind === 'envelope' || (item.kind === 'task' && item.occurredAt >= ask.since.toISOString())) && !read.has(item.id)
              ? [item]
              : [],
          );
        }),
      );
      const drop = (id: string) => {
        dropped.add(id);
        waitable.delete(id);
      };
      yield* settle([...namedIds]);
      let rows = yield* standing;
      for (;;) {
        const now = yield* Clock.currentTimeMillis;
        const verdict = yield* judge({ named, namedIds, unknown, endings, waitable, read, now, until }, rows, drop, standing);
        if (verdict !== null) return verdict;
        const woke = yield* moved.pipe(Effect.timeoutOption(Math.min(reconcileMs, Math.max(0, until - now))));
        if (Option.isNone(woke)) {
          yield* settle([...namedIds]);
          rows = yield* standing;
          continue;
        }
        yield* settle(woke.value.filter((id) => namedIds.has(id)));
        rows = woke.value.includes(waiter.id) ? yield* standing : [];
      }
    }),
  );
}
const arrivalOf = Effect.fnUntraced(function* (
  threads: Context.Service.Shape<typeof Threads>,
  waiter: ThreadEnvelopeSender,
  named: ReadonlyMap<string, string>,
  row: StandingArrival,
): Effect.fn.Return<ThreadWaitArrival, ThreadPlaneFailure> {
  const senderId = row.sender.kind === 'thread' ? row.sender.threadId : null;
  const from = senderId === null ? null : (named.get(senderId) ?? (yield* threads.find(senderId, waiter.principal))?.name ?? senderId);
  return {
    from,
    intent: row.body.intent,
    envelopeId: row.id,
    text: row.body.text,
    report: row.body.intent === 'report' ? reportKindOf(row.id) : null,
    answer: row.kind === 'envelope' ? (row.body.answer ?? null) : null,
  };
});
const fromNamed = (watched: Watched, row: StandingArrival): boolean =>
  row.sender.kind === 'thread' && watched.namedIds.has(row.sender.threadId);
export function waitForArrivals(
  threads: Context.Service.Shape<typeof Threads>,
  directory: Context.Service.Shape<typeof ThreadDirectory>,
  inbox: Context.Service.Shape<typeof ThreadInbox>,
  reconcileMs: number,
  waiter: ThreadEnvelopeSender,
  ask: ThreadWaitAsk,
  targets: readonly (ThreadRecord | null)[],
): Effect.Effect<ThreadWaitResult, ThreadPlaneFailure> {
  return watching<ThreadWaitResult>(
    threads,
    directory,
    inbox,
    reconcileMs,
    waiter,
    ask,
    targets,
    Effect.fnUntraced(function* (watched, rows) {
      if (rows.length === 0 && watched.waitable.size > 0 && watched.now < watched.until) return null;
      const arrivals = yield* Effect.forEach(rows, (row) => arrivalOf(threads, waiter, watched.named, row));
      const answered = new Set(
        rows.flatMap((row) => (row.sender.kind === 'thread' && fromNamed(watched, row) ? [row.sender.threadId] : [])),
      );
      return {
        arrived: arrivals.filter((_, index) => fromNamed(watched, rows[index]!)),
        others: arrivals.filter((_, index) => !fromNamed(watched, rows[index]!)),
        silent: [...watched.namedIds]
          .filter((id) => !answered.has(id) && !watched.endings.has(id))
          .map((id) => watched.named.get(id) ?? id),
        ended: [...watched.endings]
          .filter(([id]) => !answered.has(id))
          .map(([id, ending]) => ({ address: watched.named.get(id) ?? id, ending })),
        unknown: watched.unknown,
        expired: rows.length === 0 && watched.waitable.size > 0 && watched.now >= watched.until,
      } satisfies ThreadWaitResult;
    }),
  );
}
export function collectReports(
  threads: Context.Service.Shape<typeof Threads>,
  directory: Context.Service.Shape<typeof ThreadDirectory>,
  inbox: Context.Service.Shape<typeof ThreadInbox>,
  reconcileMs: number,
  waiter: ThreadEnvelopeSender,
  ask: ThreadWaitAsk,
  targets: readonly (ThreadRecord | null)[],
): Effect.Effect<ReadonlyMap<string, ThreadWaitArrival>, ThreadPlaneFailure> {
  const reports = new Map<string, ThreadWaitArrival>();
  return watching<ReadonlyMap<string, ThreadWaitArrival>>(
    threads,
    directory,
    inbox,
    reconcileMs,
    waiter,
    ask,
    targets,
    Effect.fnUntraced(function* (watched, rows, drop, latest) {
      const collect = Effect.fnUntraced(function* (arrivals: readonly StandingArrival[]) {
        for (const row of arrivals) {
          watched.read.add(row.id);
          if (row.body.intent !== 'report' || !fromNamed(watched, row) || row.sender.kind !== 'thread') continue;
          const arrival = yield* arrivalOf(threads, waiter, watched.named, row);
          if (arrival.from !== null) reports.set(arrival.from, arrival);
          drop(row.sender.threadId);
        }
      });
      yield* collect(rows);
      if (watched.now >= watched.until || reports.size === watched.namedIds.size) return reports;
      if (watched.waitable.size > 0) return null;
      for (const id of watched.namedIds) {
        if (reports.has(watched.named.get(id) ?? id) || watched.endings.get(id) === 'archived') continue;
        const owed = yield* inbox.openRequests(id);
        if (owed.some((request) => request.sender.kind === 'thread' && request.sender.threadId === waiter.id)) return null;
      }
      yield* collect(yield* latest);
      return reports;
    }),
    'all',
  );
}
