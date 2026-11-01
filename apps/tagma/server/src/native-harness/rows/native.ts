import type { ThreadBirthCarried, ThreadRow } from '@runlith/agent/thread/rows';
import type { TeamLayer } from '@runlith/agent/collaboration/team';
import { THREAD_RUN_AWAITING_QUESTION_STAGE } from '@runlith/agent/thread/storage/runs';
import { and, asc, desc, eq, isNotNull, not, sql, type SQL } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit, type WriteUnit } from '../../platform/contract/service/units.js';
import { type WriteSet, writes } from '../../platform/contract/service/writes.js';
import { threadCompactionCheckpoint } from '../store/thread.js';
import { nativeRows, thread, threadRun, stalledKernelThread, unparkedRun } from '../../threads/store/kernel.js';
import { roadOf, seatKernel } from '../../threads/store/seat.js';
import type { HarnessRoad, HarnessSeat } from '../../threads/contract/wire/harness/seat.js';
import { HARNESS_AGENT_ID } from '../../threads/contract/wire/harness/names.js';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { TransportBinding } from '@runlith/agent/thread/record';
import type { TransportCapabilities } from '@runlith/agent/thread/record';
import { recordFacts } from '../../thread-record/facts.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { writeMandate } from '../../threads/mandate.js';
import { sessionOf } from '../../threads/store/harnessFacet.js';
import { insertSession } from '../../threads/store/harnessFacet.js';
import { forkThreadName, randomThreadName } from '../../thread-record/contract/wire/name.js';
import { DEFAULT_TITLE } from '../../thread-record/contract/wire/title.js';
import { parseExternalSession, type ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { ThreadStore } from './threadRow.js';

export type BornThread = ThreadRow & {
  readonly projectId: number;
  readonly scopeBlockUuid: string | null;
  readonly harness: ExternalSession | null;
};

export type GraphCursor = {
  readonly projectId: number;
  readonly scopeBlockUuid: string | null;
  readonly eventId: number;
};

export type WorldStateRecord = {
  readonly snapshot: Record<string, unknown>;
  readonly checkpointId: string | null;
  readonly contextRuns: readonly string[] | null;
};

export type ForkOrigin = {
  readonly thread: string;
  readonly at: Date;
};

export type WorldStateReading = WorldStateRecord & {
  readonly fork: ForkOrigin | null;
};

export type StalledRun = {
  readonly threadId: string;
  readonly projectId: number;
  readonly runId: string;
  readonly movedAt: Date;
};

type StoredSeat = {
  readonly seated: TransportBinding | null;
  readonly capabilities: TransportCapabilities | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly account: string | null;
  readonly switches: ModelSwitches | null;
};

const seatOf = (facet: ExternalSession | null, kernel: StoredSeat): HarnessSeat | null =>
  facet === null
    ? null
    : {
        facet,
        kernel:
          kernel.seated === null || kernel.capabilities === null || kernel.provider === null
            ? null
            : {
                transport: kernel.seated,
                capabilities: kernel.capabilities,
                selection: { provider: kernel.provider, model: kernel.model, reasoning: kernel.reasoning },
                account: kernel.account,
                switches: kernel.switches ?? {},
              },
      };

export type NativeThreadRows = Effect.Success<ReturnType<typeof makeNativeThreadRows>>;

export const makeNativeThreadRows = Effect.fnUntraced(function* ({ threads }: { readonly threads: ThreadStore }) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const records = yield* ThreadRecords;

  const session = Effect.fnUntraced(function* (tx: Unit<'machine'>, threadId: string, seat: HarnessSeat) {
    yield* insertSession(db, tx, threadId, seat.facet);
    if (seat.kernel === null) return;
    yield* seatKernel(db, tx, threadId, seat.kernel);
  });

  const facetOf = (unit: Unit<'machine'>, id: string) =>
    Effect.map(
      unit.run(
        db
          .select({
            projectId: recordFacts.projectId,
            scopeBlockUuid: recordFacts.scopeBlockUuid,
            title: recordFacts.title,
            archivedAt: recordFacts.archivedAt,
            harness: sessionOf(recordFacts.id),
            seated: thread.transport,
            capabilities: thread.capabilities,
            provider: thread.provider,
            model: thread.model,
            reasoning: thread.reasoning,
            account: thread.account,
            switches: thread.switches,
            contextEventId: thread.contextEventId,
            worldStateSnapshot: thread.worldStateSnapshot,
            worldStateCheckpointId: thread.worldStateCheckpointId,
            contextRuns: thread.contextRuns,
          })
          .from(recordFacts)
          .leftJoin(thread, eq(thread.id, recordFacts.id))
          .where(and(eq(recordFacts.id, id), isNotNull(recordFacts.projectId)))
          .get(),
      ),
      (row) =>
        row === undefined || row.projectId === null
          ? undefined
          : {
              projectId: row.projectId,
              scopeBlockUuid: row.scopeBlockUuid,
              title: row.title ?? DEFAULT_TITLE,
              archivedAt: row.archivedAt,
              harness: seatOf(parseExternalSession(row.harness), row),
              contextEventId: row.contextEventId ?? 0,
              worldStateSnapshot: row.worldStateSnapshot ?? {},
              worldStateCheckpointId: row.worldStateCheckpointId,
              contextRuns: row.contextRuns,
            },
    );

  const advance = (set: WriteSet, write: (unit: Unit<'machine'>) => Effect.Effect<void, StoreFailure>, tx?: Unit<'machine'>) =>
    tx ? write(tx) : units.write(set, write);

  return {
    attachFacet: Effect.fnUntraced(function* (
      input: {
        threadId: string;
        projectId: number;
        scopeBlockUuid?: string;
        title?: string;
        name?: string;
        createdBySessionId?: number | null;
        harness?: HarnessSeat;
        delegation?: boolean;
        team?: TeamLayer;
      },
      tx: WriteUnit<'machine'>,
    ) {
      const taken = input.title !== undefined ? new Set<string>() : yield* records.namesIn(input.projectId, tx);
      const named = input.name !== undefined && !taken.has(input.name) ? input.name : randomThreadName(taken);
      const scoped = yield* records.scope(tx, input.threadId, {
        projectId: input.projectId,
        scopeBlockUuid: input.scopeBlockUuid ?? null,
        createdBySessionId: input.createdBySessionId ?? null,
        harness: input.harness?.facet.name,
        ...(input.title !== undefined
          ? { title: input.title, titleOrigin: 'manual' as const }
          : { title: named, titleOrigin: 'random' as const }),
      });
      if (!scoped) return yield* Effect.die(new Error('Tagma thread facet insert returned no row.'));
      if (input.harness !== undefined) yield* session(tx, input.threadId, input.harness);
      if (input.delegation !== undefined || input.team !== undefined)
        yield* writeMandate(db, tx, input.threadId, { delegation: input.delegation, team: input.team });
      const created = yield* threads.find(input.threadId, tx);
      if (!created) return yield* Effect.die(new Error(`Tagma thread ${input.threadId} vanished inside its own insert.`));
      if ((input.harness !== undefined) !== (created.agentId === 'harness'))
        return yield* Effect.die(new Error(`Thread ${input.threadId}: a harness facet belongs to exactly the harness agent.`));
      return {
        ...created,
        projectId: input.projectId,
        scopeBlockUuid: input.scopeBlockUuid ?? null,
        harness: input.harness?.facet ?? null,
      };
    }),
    inheritFacet: Effect.fnUntraced(function* (
      input: {
        threadId: string;
        fromThreadId: string;
        contextFrom?: string;
        agentId: string;
        harness?: HarnessSeat | null;
        carried?: ThreadBirthCarried;
        isRoot?: boolean;
        title?: string;
        projectId?: number;
      },
      tx: WriteUnit<'machine'>,
    ) {
      const parent = yield* facetOf(tx, input.fromThreadId);
      if (!parent) return undefined;
      const context =
        input.contextFrom === undefined || input.contextFrom === input.fromThreadId ? parent : yield* facetOf(tx, input.contextFrom);
      const harness = input.harness ?? (input.agentId === HARNESS_AGENT_ID ? parent.harness : null);
      if (input.agentId === HARNESS_AGENT_ID && harness === null)
        return yield* Effect.die(new Error(`Thread ${input.threadId}: a harness child needs a facet.`));
      const projectId = input.projectId ?? parent.projectId;
      const home = projectId === parent.projectId;
      yield* records.scope(tx, input.threadId, {
        projectId,
        scopeBlockUuid: home ? parent.scopeBlockUuid : null,
        archivedAt: home ? parent.archivedAt : null,
        harness: harness?.facet.name,
        ...(input.title !== undefined
          ? { title: input.title, titleOrigin: 'manual' as const }
          : input.isRoot
            ? { title: forkThreadName((context ?? parent).title), titleOrigin: 'random' as const }
            : { title: input.agentId, titleOrigin: 'agent' as const }),
      });
      if (harness !== null) yield* session(tx, input.threadId, harness);
      if (harness !== null && input.agentId !== HARNESS_AGENT_ID) {
        yield* records.harnessed(tx, input.threadId, { harness: harness.facet.name, agentId: HARNESS_AGENT_ID });
      }
      if (input.carried === 'all' || input.carried === 'turns' || input.carried === 'before') {
        const told = input.carried === 'all' && context !== undefined && projectId === context.projectId ? context : null;
        yield* tx.run(
          db
            .update(thread)
            .set({
              forkOf: input.contextFrom ?? input.fromThreadId,
              ...(told === null
                ? {}
                : {
                    contextEventId: told.contextEventId,
                    worldStateSnapshot: told.worldStateSnapshot,
                    worldStateCheckpointId: told.worldStateCheckpointId,
                    contextRuns: told.contextRuns,
                  }),
            })
            .where(eq(thread.id, input.threadId)),
        );
      }
      return projectId;
    }),
    historyOf: (id: string) => threads.historyOf(id),
    toldStateOf: threads.toldStateOf,
    stalledRuns: (now: Date): Effect.Effect<readonly StalledRun[], StoreFailure> =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .select({ threadId: thread.id, projectId: recordFacts.projectId, runId: threadRun.id, movedAt: thread.updatedAt })
              .from(threadRun)
              .innerJoin(thread, eq(thread.id, threadRun.threadId))
              .innerJoin(recordFacts, eq(recordFacts.id, thread.id))
              .where(and(unparkedRun, stalledKernelThread(now)))
              .orderBy(asc(thread.updatedAt), asc(thread.id)),
          ),
          (rows) => rows.flatMap((row) => (row.projectId === null ? [] : [{ ...row, projectId: row.projectId }])),
        ),
      ),
    road: (id: string): Effect.Effect<HarnessRoad, StoreFailure> => units.read((unit) => roadOf(db, unit, id)),
    graphCursor: (id: string): Effect.Effect<GraphCursor | undefined, StoreFailure> =>
      units.read((unit) =>
        unit.run(
          db
            .select({
              projectId: sql<number>`${recordFacts.projectId}`,
              scopeBlockUuid: recordFacts.scopeBlockUuid,
              eventId: thread.contextEventId,
            })
            .from(thread)
            .innerJoin(recordFacts, eq(recordFacts.id, thread.id))
            .where(and(eq(thread.id, id), isNotNull(recordFacts.projectId)))
            .get(),
        ),
      ),
    worldStateSnapshot: (id: string): Effect.Effect<WorldStateReading, StoreFailure> =>
      units.read((unit) =>
        unit
          .run(
            db
              .select({
                snapshot: thread.worldStateSnapshot,
                checkpointId: thread.worldStateCheckpointId,
                contextRuns: thread.contextRuns,
                forkOf: thread.forkOf,
                bornAt: recordFacts.createdAt,
              })
              .from(thread)
              .leftJoin(recordFacts, eq(recordFacts.id, thread.id))
              .where(eq(thread.id, id))
              .get(),
          )
          .pipe(
            Effect.map((row) => ({
              snapshot: row?.snapshot ?? {},
              checkpointId: row?.checkpointId ?? null,
              contextRuns: row?.contextRuns ?? null,
              fork: row?.forkOf == null || row.bornAt == null ? null : { thread: row.forkOf, at: row.bornAt },
            })),
          ),
      ),
    latestCompactionCheckpointId: (id: string): Effect.Effect<string | null, StoreFailure> =>
      units.read((unit) =>
        unit
          .run(
            db
              .select({ id: threadCompactionCheckpoint.id })
              .from(threadCompactionCheckpoint)
              .where(eq(threadCompactionCheckpoint.threadId, id))
              .orderBy(desc(threadCompactionCheckpoint.createdAt), desc(threadCompactionCheckpoint.id))
              .get(),
          )
          .pipe(Effect.map((row) => row?.id ?? null)),
      ),
    advanceWorldState: (id: string, state: WorldStateRecord, tx?: Unit<'machine'>) =>
      advance(
        writes('NativeThreadRows.advanceWorldState', [nativeRows]),
        (unit) =>
          Effect.asVoid(
            unit.run(
              db
                .update(thread)
                .set({ worldStateSnapshot: state.snapshot, worldStateCheckpointId: state.checkpointId, contextRuns: state.contextRuns })
                .where(eq(thread.id, id)),
            ),
          ),
        tx,
      ),
    advanceGraphCursor: (id: string, through: { eventId: number }, tx?: Unit<'machine'>) =>
      advance(
        writes('NativeThreadRows.advanceGraphCursor', [nativeRows]),
        (unit) => Effect.asVoid(unit.run(db.update(thread).set({ contextEventId: through.eventId }).where(eq(thread.id, id)))),
        tx,
      ),
  };
});
