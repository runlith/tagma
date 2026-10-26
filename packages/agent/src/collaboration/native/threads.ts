import { Clock, Effect, Layer } from 'effect';
import { keyOrder, type PageKey, page, pastKey, readCursor } from '@runlith/paging';
import { keptSwitches, type ModelSwitches } from '@runlith/llm/models/description';
import { ThreadAgents } from '../../thread/agents/ThreadAgents';
import { agentTypeId } from '../../thread/agents/AgentProfile';
import { ThreadStorageFailed } from '../../thread/persisted';
import type { ThreadReadFailure, ThreadRecord } from '../../thread/record';
import type { ThreadMetadataRow, ThreadRow, ThreadRunRow } from '../../thread/rows';
import { ThreadBranch } from '../../thread/run/ThreadBranch';
import { ThreadChanges } from '../../thread/run/ThreadChanges';
import { ThreadRunLedger } from '../../thread/run/ThreadRunLedger';
import { ThreadSnapshots } from '../../thread/run/ThreadSnapshots';
import { ThreadNotFoundError } from '../../thread/storage/aggregate';
import { type ThreadBorderFailed, ThreadMissing, storageFailed, threadCauseOf } from '../../thread/ThreadBorder';
import {
  StandingSwitches,
  ThreadBirthRecords,
  ThreadLeaseRhythm,
  ThreadInbox,
  ThreadStore,
  ThreadTransitions,
  type ThreadWriteTx,
} from '../../thread/ThreadPorts';
import { readBirthRecord, writeBirthRecord, type BirthSettled } from '../../thread/transition/kernel';
import { spawnRequestId } from '../births';
import { DeclaredCollaboration } from '../CollaborationConfig';
import {
  BirthConflict,
  type BirthFailure,
  type BirthInput,
  BirthRefused,
  BirthUnavailable,
  birthKeyed,
  IDLE_RANK,
  THREAD_LIST,
  THREAD_LIST_ORDER,
  type ThreadDirectoryRow,
  threadListKey,
  Threads,
} from '../threads';
import { currentRunOf } from '../../thread/state';
import { modelOf } from './modelChoice';
import { recordOf } from './record';
type BirthUnit =
  | {
      readonly born: ThreadMetadataRow;
    }
  | {
      readonly settled: BirthSettled;
    }
  | {
      readonly stale: true;
    };
const STALE_BIRTH = { stale: true } as const;
const listOrder = keyOrder(THREAD_LIST_ORDER);
function inheritedOf(row: ThreadMetadataRow): string {
  return JSON.stringify([
    row.ownerId,
    row.createdBy,
    row.spawnRootId,
    row.cacheGroup,
    row.hostKind,
    row.hostId,
    row.account,
    row.provider,
    row.model,
    row.reasoning,
    row.switches,
    row.authority,
  ]);
}
function birthFailure(call: string): (failure: ThreadBorderFailed) => BirthFailure {
  return (failure) => {
    const cause = threadCauseOf(failure);
    if (cause instanceof ThreadNotFoundError) return new ThreadMissing({ threadId: cause.threadId });
    return cause instanceof BirthRefused ? cause : storageFailed(call)(failure);
  };
}
export const nativeThreadsLayer: Layer.Layer<
  Threads,
  never,
  | DeclaredCollaboration
  | ThreadAgents
  | ThreadBranch
  | ThreadChanges
  | StandingSwitches
  | ThreadBirthRecords
  | ThreadLeaseRhythm
  | ThreadInbox
  | ThreadRunLedger
  | ThreadSnapshots
  | ThreadStore
  | ThreadTransitions
> = Layer.effect(
  Threads,
  Effect.gen(function* () {
    const agents = yield* ThreadAgents;
    const branch = yield* ThreadBranch;
    const changes = yield* ThreadChanges;
    const switches = yield* StandingSwitches;
    const births = yield* ThreadBirthRecords;
    const lease = yield* ThreadLeaseRhythm;
    const declared = yield* DeclaredCollaboration;
    const inbox = yield* ThreadInbox;
    const ledger = yield* ThreadRunLedger;
    const snapshots = yield* ThreadSnapshots;
    const store = yield* ThreadStore;
    const transitions = yield* ThreadTransitions;
    const record = (row: ThreadMetadataRow) => recordOf(agents, declared?.models() ?? null, row);
    const find = (threadId: string, principal: string): Effect.Effect<ThreadRecord | null, ThreadReadFailure> =>
      store.metadata(threadId).pipe(
        Effect.map((row) => (row && row.ownerId === principal ? record(row) : null)),
        Effect.mapError(storageFailed('threads.find')),
      );
    const bornSwitches = Effect.fnUntraced(function* (
      parent: ThreadMetadataRow,
      chosen: {
        readonly provider: string;
        readonly model: string;
      },
      asked: ModelSwitches,
    ): Effect.fn.Return<ModelSwitches, ThreadBorderFailed> {
      const models = declared?.models() ?? null;
      if (models === null) return asked;
      const option = yield* Effect.try({
        try: () => models.resolveTextModel(chosen.provider, chosen.model),
        catch: (cause) => new ThreadStorageFailed({ call: 'threads.create', cause }),
      });
      const sameModel = parent.provider === option.provider && modelOf(models, parent) === option.id;
      const own = { ...(sameModel ? keptSwitches(option.switches, parent.switches) : {}), ...keptSwitches(option.switches, asked) };
      if (switches === null || option.switches.every((switchOf) => switchOf.id in own)) return own;
      const standing = yield* switches.of({ ownerId: parent.ownerId, provider: option.provider, model: option.id });
      return { ...keptSwitches(option.switches, standing), ...own };
    });
    const standingChild = Effect.fnUntraced(function* (childId: string | null, receiptId: string | null, tx?: ThreadWriteTx) {
      const id = childId ?? (receiptId === null ? undefined : (yield* inbox.receipt(receiptId))?.threadId);
      const child = id === undefined ? undefined : yield* store.metadata(id, tx);
      if (!child) {
        return yield* new ThreadStorageFailed({
          call: 'threads.birth',
          cause: new Error(`The birth record under ${receiptId ?? childId} stands, but the child it names does not.`),
        });
      }
      return child;
    });
    const settledBirth = Effect.fnUntraced(function* (input: BirthInput, settled: BirthSettled) {
      if ('spent' in settled) return { status: 'spent' as const, at: settled.spent };
      if ('reused' in settled) {
        return yield* new BirthConflict({ childId: null, key: input.request.key, reason: 'spawn-conflict' });
      }
      if ('taken' in settled) {
        return yield* new BirthConflict({ childId: input.childId, key: input.request.key, reason: 'birth-id-taken' });
      }
      const child = yield* standingChild(settled.standing, input.provision.id);
      return { status: 'created' as const, thread: record(child), acted: false };
    });
    const createOnce = Effect.fnUntraced(
      function* (input: BirthInput) {
        const parent = yield* store.metadata(input.creatorThreadId);
        if (!parent || parent.ownerId !== input.principal) {
          return yield* new ThreadMissing({ threadId: input.creatorThreadId });
        }
        const asked = input.request;
        const root = asked.root === true;
        const provision = input.provision;
        const key = birthKeyed(input.creatorThreadId, asked);
        if (asked.host !== null && births === null) {
          return yield* new BirthRefused({ childId: input.childId, reason: 'host-unadmitted' });
        }
        if (asked.host !== null && 'fork' in asked.seed) {
          return yield* new BirthRefused({ childId: input.childId, reason: 'host-with-fork' });
        }
        const judged = input.model !== null && 'judged' in input.model ? input.model : null;
        const chosen = judged?.judged ?? { provider: parent.provider, model: parent.model, reasoning: parent.reasoning };
        const switches =
          chosen.model === null
            ? parent.switches
            : yield* bornSwitches(parent, { provider: chosen.provider, model: chosen.model }, judged?.switches ?? {});
        const profile = input.offer.profile ? { id: input.offer.profile.id, overlay: input.offer.profile } : null;
        if ('fork' in asked.seed) {
          const forked = yield* branch.fork({
            birth: key,
            ownerId: input.principal,
            createdBy: parent.id,
            sourceThreadId: asked.seed.source,
            agentId: input.offer.baseAgentId,
            cut: asked.seed.fork,
            bornOf: input.bornOf,
            bindings: asked.bindings,
            spawned: {
              parentThreadId: root ? null : parent.id,
              spawnedByRunId: input.spawnedByRunId,
              name: asked.name ?? undefined,
              authority: input.authority,
              profile,
              capabilities: input.offer.capabilities,
              rehomed: asked.project === undefined ? undefined : (true as const),
              model:
                chosen.model === null
                  ? undefined
                  : { provider: chosen.provider, model: chosen.model, reasoning: chosen.reasoning, switches },
            },
            commit: (child: ThreadRow, tx: ThreadWriteTx) => inbox.put({ ...provision, threadId: child.id }, tx).pipe(Effect.asVoid),
            place: input.place ?? undefined,
            title: asked.title,
          });
          if ('settled' in forked) return yield* settledBirth(input, forked.settled);
          yield* snapshots.publish(parent.id);
          return {
            status: 'created' as const,
            thread: record(births === null ? forked.born : yield* standingChild(forked.born.id, null)),
            acted: true,
          };
        }
        const birth = yield* store.transaction(
          Effect.fnUntraced(function* (tx) {
            const settled = yield* readBirthRecord(transitions, input.childId, key, tx);
            if (settled !== null) return { settled } as BirthUnit;
            if (yield* store.metadata(input.childId, tx)) return { settled: { taken: true } } as BirthUnit;
            const held = yield* transitions.writeAtIn(parent.id, (at) => Effect.succeed(at.row), tx);
            if (!held || inheritedOf(held) !== inheritedOf(parent)) return { stale: true } as BirthUnit;
            const asking = held.pendingInteraction;
            if (asking && !(asking.type === 'question' && asking.runId === input.spawnedByRunId)) {
              return yield* new BirthRefused({ childId: input.childId, reason: 'pending-interaction' });
            }
            if (input.spawnedByRunId !== null) {
              const active = yield* ledger.activeRunIn(parent.id, tx);
              if (active && active.id !== input.spawnedByRunId) {
                return yield* new BirthConflict({ childId: input.childId, key: asked.key, reason: 'run-conflict' });
              }
            }
            if (asked.name !== null && !root) {
              const holder = yield* store.findNamed(parent.spawnRootId, parent.ownerId, asked.name, tx);
              if (holder) {
                return yield* new BirthConflict({ childId: holder.id, key: asked.key, reason: 'name-taken' });
              }
            }
            const host =
              asked.host ?? (parent.hostKind !== null && parent.hostId !== null ? { kind: parent.hostKind, id: parent.hostId } : null);
            const values = {
              id: input.childId,
              ownerId: parent.ownerId,
              agentId: input.offer.baseAgentId,
              profile,
              bornOf: input.bornOf,
              name: asked.name ?? undefined,
              authority: input.authority,
              plain: input.plain,
              hostKind: host === null ? undefined : host.kind,
              hostId: host === null ? undefined : host.id,
              bindings: asked.bindings,
              provider: chosen.provider,
              model: chosen.model,
              reasoning: chosen.reasoning,
              switches,
              capabilities: input.offer.capabilities,
            };
            const child = root
              ? yield* store.insert({ ...values, createdBy: parent.id }, tx)
              : yield* store.insertChild(
                  parent.id,
                  { ...values, createdBy: parent.createdBy ?? null, spawnedByRunId: input.spawnedByRunId },
                  tx,
                );
            if (births !== null) {
              const parentRow = yield* store.find(parent.id, tx);
              if (!parentRow) return yield* new ThreadMissing({ threadId: parent.id });
              yield* births.record(
                {
                  child,
                  parent: parentRow,
                  carried: 'fresh',
                  typeId: asked.typeId,
                  title: asked.title,
                  host: asked.host ?? undefined,
                  place: input.place ?? undefined,
                },
                tx,
              );
            }
            yield* inbox.put(provision, tx);
            yield* writeBirthRecord(transitions, child.id, key, tx);
            return { born: births === null ? child : yield* standingChild(child.id, null, tx) } as BirthUnit;
          }),
        );
        if ('stale' in birth) return STALE_BIRTH;
        if ('settled' in birth) return yield* settledBirth(input, birth.settled);
        yield* snapshots.publish(parent.id);
        return { status: 'created' as const, thread: record(birth.born), acted: true };
      },
      (effect, input) =>
        effect.pipe(
          Effect.catch((failure): Effect.Effect<never, BirthFailure> =>
            failure instanceof BirthConflict || failure instanceof BirthRefused || failure instanceof ThreadMissing
              ? Effect.fail(failure)
              : Effect.fail(birthFailure('threads.create')(failure)),
          ),
        ),
    );
    return Threads.of({
      create: Effect.fnUntraced(function* (input) {
        for (;;) {
          const answer = yield* createOnce(input);
          if (!('stale' in answer)) return answer;
          if ((yield* Clock.currentTimeMillis) >= input.deadline.getTime()) {
            return yield* new BirthUnavailable({ childId: input.childId, reason: 'deadline' });
          }
        }
      }),
      list: Effect.fnUntraced(
        function* (query) {
          const from = yield* store.metadata(query.from);
          if (!from || from.ownerId !== query.principal) return { rows: [], total: 0, cursor: null };
          const now = new Date(yield* Clock.currentTimeMillis);
          const reading = query.cursor === undefined ? null : readCursor(query.cursor, THREAD_LIST);
          const at = reading !== null && 'at' in reading ? reading.at : null;
          const keyed = (rows: readonly ThreadMetadataRow[], active: ReadonlyMap<string, ThreadRunRow>) =>
            rows
              .map((row) => {
                const run = active.get(row.id);
                const life = (run === undefined ? null : currentRunOf(run, row, now, lease))?.life ?? 'idle';
                return { row, key: threadListKey(life, row.updatedAt, row.id) };
              })
              .sort((left, right) => listOrder(left.key, right.key));
          const ask = {
            spawnRootId: from.spawnRootId,
            ownerId: query.principal,
            parent: query.parent,
          };
          let active: ReadonlyMap<string, ThreadRunRow>;
          let ordered: readonly {
            readonly row: ThreadMetadataRow;
            readonly key: PageKey;
          }[];
          let total: number;
          if (query.ids !== undefined) {
            const chosen = (yield* Effect.forEach(new Set(query.ids), (id) => store.metadata(id), { concurrency: 8 })).filter(
              (row): row is ThreadMetadataRow =>
                row !== undefined &&
                row.ownerId === query.principal &&
                row.spawnRootId === from.spawnRootId &&
                (query.parent === undefined || row.parentThreadId === query.parent),
            );
            active = new Map((yield* ledger.runningOf(chosen.map((row) => row.id))).map((run) => [run.threadId, run]));
            const sorted = keyed(chosen, active);
            ordered = at === null ? sorted : pastKey(sorted, (entry) => entry.key, THREAD_LIST_ORDER, at);
            total = chosen.length;
          } else {
            const going = (yield* store.pageTeam({ ...ask, within: 'running', limit: Number.MAX_SAFE_INTEGER })).rows;
            active = new Map((yield* ledger.runningOf(going.map((row) => row.id))).map((run) => [run.threadId, run]));
            const heads = keyed(going, active);
            const restHeads = at === null ? heads : pastKey(heads, (entry) => entry.key, THREAD_LIST_ORDER, at);
            const after = at !== null && at[0] === IDLE_RANK ? { movedAt: new Date(Number(at[1])), id: String(at[2]) } : undefined;
            const idle = yield* store.pageTeam({
              ...ask,
              within: 'resting',
              limit: Math.max(0, query.limit + 1 - restHeads.length),
              after: after,
            });
            ordered = [...restHeads, ...idle.rows.map((row) => ({ row, key: threadListKey('idle', row.updatedAt, row.id) }))];
            total = idle.total;
          }
          const cut = page({ rows: ordered, asked: query.limit, keyOf: (entry) => entry.key, question: THREAD_LIST, total });
          const resting = cut.rows.filter(({ row }) => !active.has(row.id)).map(({ row }) => row.id);
          const latestOf = new Map((yield* ledger.latestRuns(resting)).map((run) => [run.threadId, run] as const));
          const rows = cut.rows.map(({ row }): ThreadDirectoryRow => {
            const latest = active.get(row.id) ?? latestOf.get(row.id) ?? null;
            const running = latest !== null && latest.status === 'running' ? latest : null;
            const movedAt = row.updatedAt;
            const model = modelOf(declared?.models() ?? null, row);
            return {
              threadId: row.id,
              projectId: null,
              agentId: row.agentId,
              typeId: agentTypeId(row.agentId, row.profile?.id ?? null, row.transport.agent),
              name: row.name,
              spawnRootId: row.spawnRootId,
              parentThreadId: row.parentThreadId,
              spawnedByRunId: row.spawnedByRunId,
              movedAt,
              selection: model === null ? null : { provider: row.provider, model, reasoning: row.reasoning, account: row.account },
              provider: row.provider,
              capabilities: row.capabilities,
              contextReading: row.contextReading,
              run: running === null ? null : currentRunOf(running, row, now, lease),
              assignment: latest?.status ?? null,
              failureReason: latest?.failureReason ?? null,
              failure: latest?.failure ?? null,
            };
          });
          return { rows, total, cursor: cut.next };
        },
        (effect, query) => effect.pipe(Effect.mapError(storageFailed('threads.list'))),
      ),
      find,
      named: (principal, spawnRootId, name) =>
        store.findNamed(spawnRootId, principal, name).pipe(
          Effect.map((row) => (row ? record(row) : null)),
          Effect.mapError(storageFailed('threads.named')),
        ),
      lineage: Effect.fnUntraced(
        function* (threadId, principal) {
          const ancestors: ThreadRecord[] = [];
          const start = yield* store.metadata(threadId);
          if (!start || start.ownerId !== principal) return { ancestors, complete: false };
          let above = start.parentThreadId;
          while (above !== null) {
            if (above === start.id || ancestors.some((ancestor) => ancestor.id === above)) return { ancestors, complete: false };
            const row = yield* store.metadata(above);
            if (!row || row.ownerId !== principal) return { ancestors, complete: false };
            ancestors.push(record(row));
            above = row.parentThreadId;
          }
          return { ancestors, complete: true };
        },
        (effect, threadId, principal) => effect.pipe(Effect.mapError(storageFailed('threads.lineage'))),
      ),
      watch: changes.watch,
      readBirth: Effect.fnUntraced(
        function* (creatorThreadId, principal, request) {
          const key = birthKeyed(creatorThreadId, request);
          const settled = yield* readBirthRecord(transitions, creatorThreadId, key);
          if (settled === null || 'taken' in settled) return { status: 'unborn' as const };
          if ('spent' in settled) return { status: 'spent' as const, at: settled.spent };
          if ('reused' in settled) return yield* new BirthConflict({ childId: null, key: request.key, reason: 'spawn-conflict' });
          const child = yield* standingChild(settled.standing, spawnRequestId(creatorThreadId, request.key));
          const creator = request.root === true ? child.createdBy : child.parentThreadId;
          if (child.ownerId !== principal || creator !== creatorThreadId) return { status: 'unborn' as const };
          return { status: 'born' as const, thread: record(child) };
        },
        (effect, creatorThreadId, principal, request) =>
          effect.pipe(
            Effect.catch((failure): Effect.Effect<never, ThreadReadFailure | BirthConflict> =>
              failure instanceof BirthConflict ? Effect.fail(failure) : Effect.fail(storageFailed('threads.readBirth')(failure)),
            ),
          ),
      ),
    });
  }),
);
