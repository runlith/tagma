import { Clock, Effect } from 'effect';
import type { ThreadPortFailure } from '../ThreadBorder';
import { ThreadStorageFailed } from '../persisted';
import { evidenceKey, type Keyed, type TransitionOutcome } from '../keyed';
import {
  InboxConflict,
  type InboxFailure,
  type InboxPlan,
  type InboxView,
  type InboxWrites,
  type ThreadInboxItem,
  type ThreadInboxItemValues,
  type ThreadInboxRequest,
  type ThreadInboxStorage,
} from './inbox';
import { attempt } from './memory/attempt';
import type { HeldRecord } from './memory/state';
import type { MemoryTx, MemoryUnits } from './memory/units';
type Closed = {
  readonly at: string;
  readonly by: string;
};
type Landing = {
  readonly items: Map<string, ThreadInboxItem>;
  readonly closed: Map<string, Closed>;
  readonly tx: MemoryTx | undefined;
  readonly staged: boolean;
};
export type InMemoryInboxStorage = ThreadInboxStorage<MemoryTx> & {
  readonly items: Map<string, ThreadInboxItem>;
  readonly closed: Map<string, Closed>;
  readonly versions: Map<string, number>;
  putFailure: unknown;
  readonly putGates: Map<string, Promise<void>>;
  forget(threadIds: ReadonlySet<string>, tx: MemoryTx): void;
};
export type MemoryInboxInput = {
  readonly units?: MemoryUnits;
  readonly calls?: Map<string, HeldRecord>;
};

export const inMemoryInboxStorage = ({ units, calls = new Map() }: MemoryInboxInput = {}): InMemoryInboxStorage => {
  const items = new Map<string, ThreadInboxItem>();
  const closed = new Map<string, Closed>();
  const versions = new Map<string, number>();
  const doubted = new Map<string, string>();
  const wakes = new Map<string, number>();
  const sequence = new Map<string, number>();
  const putGates = new Map<string, Promise<void>>();
  let accepted = 0;
  const inOrder = (a: ThreadInboxItem, b: ThreadInboxItem): number =>
    a.occurredAt.localeCompare(b.occurredAt) || (sequence.get(a.id) ?? 0) - (sequence.get(b.id) ?? 0);
  const isOpenRequest = (item: ThreadInboxItem, closedOf: ReadonlyMap<string, Closed>): item is ThreadInboxRequest =>
    item.kind === 'task' && item.body.intent === 'task' && item.sender.kind === 'thread' && !closedOf.has(item.id);
  const landing = (tx: MemoryTx | undefined): Landing => ({ items, closed, tx, staged: false });
  const atomic = <T>(
    call: string,
    tx: MemoryTx | undefined,
    work: (unit: MemoryTx | undefined) => T,
  ): Effect.Effect<T, ThreadPortFailure> =>
    units === undefined ? attempt(call, () => work(tx)) : units.commit((unit) => attempt(call, () => work(unit)), tx);
  const seen = <T>(call: string, tx: MemoryTx | undefined, work: () => T): Effect.Effect<T, ThreadPortFailure> =>
    attempt(call, () => (units === undefined ? work() : units.read(tx, work)));
  const store = <K, V>(tx: MemoryTx | undefined, into: Map<K, V>, key: K, value: V): void => {
    if (tx === undefined) into.set(key, value);
    else tx.put(into, key, value);
  };
  const write = <V>(landed: Landing, into: Map<string, V>, key: string, value: V): void => {
    store(landed.staged ? undefined : landed.tx, into, key, value);
  };
  const moved = (landed: Landing, threadId: string): void => {
    if (landed.staged) return;
    store(landed.tx, versions, threadId, (versions.get(threadId) ?? 0) + 1);
  };
  const putIn = (
    landed: Landing,
    values: ThreadInboxItemValues,
  ): {
    item: ThreadInboxItem;
    fresh: boolean;
  } => {
    const standing = landed.items.get(values.id) ?? items.get(values.id);
    if (standing) return { item: standing, fresh: false };
    const item = { ...values, state: 'queued', deliveredToRunId: null } as ThreadInboxItem;
    accepted += 1;
    store(landed.tx, sequence, values.id, accepted);
    write(landed, landed.items, values.id, item);
    moved(landed, item.threadId);
    return { item, fresh: true };
  };
  const acknowledgeIn = (landed: Landing, ids: readonly string[], runId: string | null): void => {
    for (const id of ids) {
      const item = landed.items.get(id) ?? items.get(id);
      if (item && item.state !== 'acknowledged') {
        write(landed, landed.items, id, {
          ...item,
          state: 'acknowledged',
          deliveredToRunId: runId === null ? item.deliveredToRunId : runId,
        });
        moved(landed, item.threadId);
      }
    }
  };
  const closeIn = (landed: Landing, ids: readonly string[], by: string, at: string): readonly string[] => {
    return ids.filter((id) => {
      const item = landed.items.get(id) ?? items.get(id);
      if (item?.kind !== 'task' || landed.closed.has(id) || closed.has(id)) return false;
      write(landed, landed.closed, id, { at, by });
      moved(landed, item.threadId);
      return true;
    });
  };
  const viewOf = (staged: Landing): InboxView => {
    const itemOf = (id: string) => staged.items.get(id) ?? items.get(id) ?? null;
    const closedOf = (id: string) => staged.closed.get(id) ?? closed.get(id);
    return {
      request: (requestId) =>
        Effect.sync(() => {
          const item = itemOf(requestId);
          if (item === null || item.kind !== 'task') return null;
          const state = closedOf(requestId) ? 'closed' : item.deliveredToRunId === null ? 'open' : 'taken';
          return { request: item, state, takenBy: item.deliveredToRunId };
        }),
      item: (itemId) => Effect.sync(() => itemOf(itemId)),
      newestTaken: (threadId, requesterThreadId) =>
        Effect.sync(() => {
          let newest: ThreadInboxRequest | null = null;
          for (const item of items.values()) {
            const current = itemOf(item.id);
            if (current === null || current.threadId !== threadId || current.kind !== 'task') continue;
            if (closedOf(current.id) || current.deliveredToRunId === null || current.body.intent !== 'task') continue;
            if (current.sender.kind !== 'thread' || current.sender.threadId !== requesterThreadId) continue;
            if (newest === null || inOrder(current, newest) > 0) {
              newest = current;
            }
          }
          return newest;
        }),
    };
  };
  const storage: InMemoryInboxStorage = {
    items,
    closed,
    versions,
    putFailure: null,
    putGates,
    put: (values, tx) => {
      const failure = storage.putFailure;
      const gate = putGates.get(values.id);
      putGates.delete(values.id);
      if (failure) return Effect.fail(new ThreadStorageFailed({ call: 'put', cause: failure }));
      return Effect.andThen(gate ? Effect.promise(() => gate) : Effect.void, () =>
        atomic('put', tx, (unit) => putIn(landing(unit), values)),
      );
    },
    forget: (threadIds, tx) => {
      for (const [id, item] of items) {
        if (!threadIds.has(item.threadId)) continue;
        tx.remove(items, id);
        tx.remove(closed, id);
        tx.remove(sequence, id);
        tx.remove(wakes, id);
      }
      for (const [key, call] of calls) if (threadIds.has(call.threadId)) tx.remove(calls, key);
    },
    deliver: (ids, runId, tx) =>
      atomic('deliver', tx, (unit) => {
        const landed = landing(unit);
        for (const id of ids) {
          const item = items.get(id);
          if (item && item.state !== 'acknowledged') {
            store(unit, items, id, { ...item, state: 'delivered', deliveredToRunId: runId });
            moved(landed, item.threadId);
          }
        }
      }),
    acknowledge: (ids, runId, tx) => atomic('acknowledge', tx, (unit) => acknowledgeIn(landing(unit), ids, runId)),
    returnTo: (runId, tx) =>
      atomic('returnTo', tx, (unit) => {
        const landed = landing(unit);
        const returned: string[] = [];
        for (const item of items.values()) {
          if (item.deliveredToRunId !== runId || item.state === 'queued' || closed.has(item.id)) continue;
          store(unit, items, item.id, { ...item, state: 'queued', deliveredToRunId: null });
          moved(landed, item.threadId);
          returned.push(item.id);
        }
        return returned;
      }),
    fated: (threadId, runId, ids, fate, tx) =>
      atomic('fated', tx, (unit) => {
        const landed = landing(unit);
        if (fate === 'acknowledged' || fate === 'withdrawn') return acknowledgeIn(landed, ids, fate === 'acknowledged' ? runId : null);
        for (const id of ids) {
          const item = items.get(id);
          if (item === undefined || item.threadId !== threadId || item.state === 'acknowledged') continue;
          if (fate === 'unconfirmed') store(unit, doubted, id, runId);
          else if (unit === undefined) doubted.delete(id);
          else unit.remove(doubted, id);
          const settled =
            fate === 'returned'
              ? { ...item, state: 'queued' as const, deliveredToRunId: null }
              : {
                  ...item,
                  state: fate === 'read' && item.kind !== 'task' ? ('acknowledged' as const) : ('delivered' as const),
                  deliveredToRunId: runId,
                };
          store(unit, items, id, settled);
          moved(landed, threadId);
        }
      }),
    pending: (threadId, tx) =>
      seen('pending', tx, () =>
        [...items.values()].filter((item) => item.threadId === threadId && item.state !== 'acknowledged').sort(inOrder),
      ),
    pendingOf: (threadIds, tx) =>
      seen('pendingOf', tx, () => {
        const wanted = new Set(threadIds);
        const held = new Map<string, ThreadInboxItem[]>();
        for (const item of [...items.values()]
          .filter((entry) => wanted.has(entry.threadId) && entry.state !== 'acknowledged')
          .sort(inOrder)) {
          held.set(item.threadId, [...(held.get(item.threadId) ?? []), item]);
        }
        return held;
      }),
    arrivals: ({ threadId, after, reports }, tx) =>
      seen('arrivals', tx, () => {
        const own = [...items.values()].filter((item) => item.threadId === threadId);
        const through = own.reduce((highest, item) => Math.max(highest, sequence.get(item.id) ?? 0), 0);
        const held = own
          .filter(
            (item) =>
              (item.state !== 'acknowledged' || (reports === 'all' && item.kind === 'envelope' && item.body.intent === 'report')) &&
              (after === null || (sequence.get(item.id) ?? 0) > after),
          )
          .sort(inOrder);
        return { items: held, through };
      }),
    delivered: (threadId, runId, tx) =>
      seen('delivered', tx, () =>
        [...items.values()]
          .filter((item) => item.threadId === threadId && item.deliveredToRunId === runId)
          .sort(inOrder)
          .map((item) => item.id),
      ),
    unconfirmed: (threadId, runId, tx) =>
      seen('unconfirmed', tx, () =>
        [...items.values()]
          .filter(
            (item) =>
              item.threadId === threadId && item.state === 'delivered' && item.deliveredToRunId === runId && doubted.get(item.id) === runId,
          )
          .sort(inOrder)
          .map((item) => item.id),
      ),
    receipt: (id, tx) => seen('receipt', tx, () => items.get(id)),
    intendWake: (ids, tx) =>
      atomic('intendWake', tx, (unit) => {
        for (const id of ids) {
          if (!items.has(id) && !landing(unit).items.has(id)) continue;
          if (wakes.has(id)) continue;
          accepted += 1;
          store(unit, wakes, id, accepted);
        }
      }),
    pendingWakes: (limit, tx) =>
      seen('pendingWakes', tx, () =>
        [...wakes.entries()]
          .sort((a, b) => a[1] - b[1])
          .flatMap(([id]) => {
            const item = items.get(id);
            return item === undefined ? [] : [item];
          })
          .slice(0, limit),
      ),
    woke: (ids, tx) =>
      atomic('woke', tx, (unit) => {
        for (const id of ids) {
          if (unit === undefined) wakes.delete(id);
          else unit.remove(wakes, id);
        }
      }),
    openRequests: (threadId, tx) =>
      seen('openRequests', tx, () =>
        [...items.values()]
          .filter((item): item is ThreadInboxRequest => item.threadId === threadId && isOpenRequest(item, closed))
          .sort(inOrder),
      ),
    openRequestsUnder: (idPrefixes, tx) =>
      seen('openRequestsUnder', tx, () =>
        [...items.values()]
          .filter(
            (item): item is ThreadInboxRequest => idPrefixes.some((prefix) => item.id.startsWith(prefix)) && isOpenRequest(item, closed),
          )
          .sort(inOrder),
      ),
    closeRequests: (ids, by, tx) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        atomic('closeRequests', tx, (unit) => closeIn(landing(unit), ids, by, new Date(now).toISOString())),
      ),
    control: Effect.fnUntraced(function* <A>(
      threadId: string,
      plan: InboxPlan<A>,
      call: {
        readonly key: Keyed;
        readonly deadline: Date;
      },
    ): Effect.fn.Return<TransitionOutcome<A>, InboxFailure> {
      const keyed = 'call' in call.key.evidence ? evidenceKey(call.key.evidence) : null;
      for (;;) {
        const standing = keyed === null ? undefined : calls.get(keyed);
        if (standing !== undefined) {
          if (standing.digest !== call.key.digest) return yield* new InboxConflict({ threadId, reason: 'act-id-reused', key: call.key });
          return { replayed: standing.result as A };
        }
        const version = versions.get(threadId) ?? 0;
        const staged: Landing = {
          items: new Map<string, ThreadInboxItem>(),
          closed: new Map<string, Closed>(),
          tx: undefined,
          staged: true,
        };
        const decision = yield* plan.decide(viewOf(staged));
        if ('refuse' in decision) return { refused: decision.refuse };
        const waking = new Set<string>();
        const writes: InboxWrites = {
          put: (values) => Effect.sync(() => putIn(staged, values)),
          acknowledge: (ids, runId) => Effect.sync(() => acknowledgeIn(staged, ids, runId)),
          closeRequests: (ids, by) => Effect.map(Clock.currentTimeMillis, (now) => closeIn(staged, ids, by, new Date(now).toISOString())),
          intendWake: (ids) =>
            Effect.sync(() => {
              for (const id of ids) if (staged.items.has(id) || items.has(id)) waking.add(id);
            }),
        };
        yield* decision.apply(writes);
        const committed = yield* Effect.sync(() => {
          if ((versions.get(threadId) ?? 0) !== version) return false;
          if (keyed !== null && calls.has(keyed)) return false;
          for (const [id, item] of staged.items) items.set(id, item);
          for (const [id, closedAt] of staged.closed) closed.set(id, closedAt);
          for (const id of waking) {
            if (wakes.has(id)) continue;
            accepted += 1;
            wakes.set(id, accepted);
          }
          if (keyed !== null) {
            const digest = call.key.digest;
            calls.set(keyed, { digest, result: decision.result ?? null, threadId, spentAs: keyed });
          }
          moved(landing(undefined), threadId);
          return true;
        });
        if (committed) return { committed: decision.result };
        if ((yield* Clock.currentTimeMillis) >= call.deadline.getTime()) return { stalled: 'none' as const };
      }
    }),
  };
  return storage;
};
