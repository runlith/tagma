import { Clock, Effect } from 'effect';
import type { MemoryStorage } from '@runlith/agent/thread/conformance/memoryStorage';
import type { MemoryTx } from '@runlith/agent/thread/storage/memory/units';
import type { ThreadRow } from '@runlith/agent/thread/rows';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessTransport } from '../../threads/contract/wire/harness/names.js';
import { harnessSessionActive } from '../../threads/contract/wire/harness/session.js';
import { activeOf, leased, leaseOf } from '../../threads/store/harnessFacet.js';
import { unitOf, writeUnitOf, type Unit, type WriteUnit } from '../../platform/contract/service/units.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { SessionRows, type StandingSession } from '../contract/service/sessionRows.js';

export const memorySessionRows = Effect.fnUntraced(function* (storage: MemoryStorage) {
  const facets = new Map<string, ExternalSession>();
  const active = new Map<string, number>();
  const writesAt = new WeakMap<Unit<'machine'>, MemoryTx>();
  const runs = storage.runs({ ownerId: 'instance-1', scope: 'scope-a' });
  const within = <A, E>(work: (unit: WriteUnit<'machine'>) => Effect.Effect<A, E>) =>
    storage.units.commit((tx) => {
      const unit = writeUnitOf<'machine'>(
        Object.assign(tx, {
          store: { path: 'memory:external-sessions', generation: 0 },
          run: <T>(query: Effect.Effect<T, StoreFailure>) => query,
          afterCommit: tx.afterCommit.bind(tx),
        }),
      );
      writesAt.set(unit, tx);
      return work(unit).pipe(Effect.ensuring(Effect.sync(() => writesAt.delete(unit))));
    });
  const current = (id: string, unit?: Unit<'machine'>) =>
    storage.units.read(unit === undefined ? undefined : writesAt.get(unit), () => {
      const facet = facets.get(id);
      return facet === undefined ? null : leased(facet, leaseOf(facet));
    });
  const thread = (id: string, unit?: Unit<'machine'>) =>
    storage.aggregate.find(id, unit === undefined ? undefined : writesAt.get(unit)).pipe(Effect.orDie);
  const run = (id: string) => runs.runById(id).pipe(Effect.orDie);
  const readUnit = unitOf<'machine'>({ store: { path: 'memory:external-sessions', generation: 0 }, run: (query) => query });
  const put = Effect.fnUntraced(function* (id: string, facet: ExternalSession, unit: WriteUnit<'machine'>) {
    const held = writesAt.get(unit);
    if (held === undefined) return yield* Effect.die('the session write belongs to another storage unit');
    held.put(facets, id, facet);
  });
  const selected = Effect.fnUntraced(function* (transport: HarnessTransport, unit?: Unit<'machine'>) {
    const standing: StandingSession[] = [];
    const ids = storage.units.read(unit === undefined ? undefined : writesAt.get(unit), () => [...facets.keys()]);
    const running = new Set((yield* runs.runningOf(ids)).map((row) => row.threadId));
    for (const id of ids) {
      const facet = current(id, unit);
      if (facet === null || !harnessSessionActive(facet.session)) continue;
      if ((yield* thread(id, unit))?.transport.adapter !== transport) continue;
      standing.push({ threadId: id, facet, running: running.has(id) });
    }
    return standing;
  });
  const asked = (row: ThreadRow | undefined) =>
    row?.model === undefined || row.model === null ? undefined : { model: row.model, reasoning: row.reasoning };
  const rows = SessionRows.of({
    inspect: (work) => work(readUnit),
    within: (_operation, work) => within(work),
    writes: writes('HarnessSessionStore.change', []),
    choosing: writes('HarnessSessionStore.choose', []),
    read: (id, unit) => Effect.sync(() => current(id, unit)),
    write: put,
    sessionsStanding: selected,
    standing: (transport) => Effect.map(selected(transport), (rows) => rows.map((row) => row.threadId)),
    parked: Effect.fnUntraced(function* (ids: readonly string[]) {
      for (const id of ids) {
        const row = yield* runs.runById(id);
        if (row?.status === 'running' && row.progress.stage === 'awaiting-question') return true;
      }
      return false;
    }),
    ended: Effect.fnUntraced(function* (ids: readonly string[]) {
      for (const id of ids) {
        const row = yield* runs.runById(id);
        if (row !== null && row.status !== 'running') return true;
      }
      return false;
    }),
    activeAt: (id) => Effect.sync(() => storage.units.committed(() => active.get(id) ?? 0)),
    beat: (ownerId, transport, touched) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        within((unit) =>
          Effect.gen(function* () {
            const tx = writesAt.get(unit);
            if (tx === undefined) return yield* Effect.die('the session heartbeat belongs to another storage unit');
            const ids: string[] = [];
            const activeIds = new Set(touched);
            for (const row of yield* selected(transport, unit)) {
              const session = row.facet.session;
              if (session?.ownerId !== ownerId) continue;
              tx.put(facets, row.threadId, { ...row.facet, session: { ...session, heartbeatAt: new Date(now).toISOString() } });
              if (activeIds.has(row.threadId)) tx.put(active, row.threadId, now);
              ids.push(row.threadId);
            }
            return ids;
          }),
        ),
      ),
    asked: (id, unit) => Effect.map(thread(id, unit), asked),
    ranOn: (id) =>
      Effect.map(run(id), (row) =>
        row?.model === undefined || row.model === null ? undefined : { model: row.model, reasoning: row.reasoning },
      ),
    threadOfRun: (id) => Effect.map(run(id), (row) => row?.threadId ?? null),
    road: Effect.fnUntraced(function* (id: string) {
      const row = yield* thread(id);
      if (row === undefined) return yield* Effect.die(`Thread ${id} stands without its kernel row.`);
      return {
        transport: row.transport,
        capabilities: row.capabilities,
        provider: row.provider,
        model: row.model,
        reasoning: row.reasoning,
      };
    }),
    choose: (id, chosen, switches, account, unit) => {
      const tx = writesAt.get(unit);
      return storage.aggregate.update(id, { model: chosen?.model ?? null, reasoning: chosen?.reasoning ?? null, switches, account }, tx);
    },
    switches: (id, unit) => Effect.map(thread(id, unit), (row) => row?.switches ?? {}),
    capabilities: (id) => Effect.map(thread(id), (row) => row?.capabilities),
    binding: (id, unit) => Effect.map(thread(id, unit), (row) => row?.transport),
  });
  return {
    rows,
    seed: (id: string, facet: ExternalSession): Effect.Effect<void, HarnessFailure> =>
      within((unit) =>
        Effect.sync(() => {
          const tx = writesAt.get(unit)!;
          tx.put(facets, id, facet);
          const stamp = activeOf(facet);
          if (stamp !== null) tx.put(active, id, stamp);
        }),
      ),
  };
});
