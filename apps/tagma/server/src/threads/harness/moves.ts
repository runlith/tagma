import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { RunAdmission } from '@runlith/agent/thread/run/runAdmission';
import { ThreadModel, ThreadModelRefused } from '@runlith/agent/collaboration/model';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadModelSelection } from '@runlith/agent/thread/record';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { NATIVE_BINDING } from '@runlith/agent/thread/record';
import type { ModelCatalog } from '@runlith/llm/models/catalog';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { NATIVE_HARNESS, type HarnessId } from '../../platform/contract/wire/session.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import {
  HarnessMoves,
  type HarnessMoved,
  type HarnessMoveTo,
  HarnessRegistry,
  type HarnessSeated,
  SessionRead,
} from '../contract/service/harness.js';
import type { ThreadRecordFacts } from '../../thread-record/contract/wire/record.js';
import { ThreadRunning } from '../contract/service/reads.js';
import type { ReleaseThread } from '../contract/service/releasing.js';
import { ThreadRebinding } from '../contract/service/rebinding.js';
import { HarnessTurnStale, JOURNAL_MOVED, STALE_RETRIES } from '../contract/service/rebinding.js';
import type { ExternalSession } from '../contract/wire/harness/externalSession.js';
import { HARNESS_AGENT_ID } from '../contract/wire/harness/names.js';
import { currentEffort, currentModel } from '../contract/wire/harness/observation.js';
import { harnessSessionActive } from '../contract/wire/harness/session.js';
import { nativeCapabilities, servedSelection, type KernelSeat } from '../contract/wire/harness/seat.js';
import { mandateFacts } from '../mandate.js';
import { deleteSession, externalSession, insertSession } from '../store/harnessFacet.js';
import { thread } from '../store/kernel.js';
import { bindingOf, capabilitiesOf, switchesOf } from '../store/seat.js';
import { keptSwitches } from '@runlith/llm/models/description';

const running = (threadId: string) =>
  new GateRefusal('thread-running', `A turn of ${threadId} is going; it moves to another model between turns.`, [
    'move it once this turn ends',
    'stop the turn, then move it',
  ]);

const pinned = (threadId: string, name: string) =>
  new GateRefusal('model-pinned', `Thread ${threadId} runs ${name}, whose model was fixed at its birth.`, [
    'start a new agent on the model you need, with this one’s report as its brief',
  ]);

const resolved = (registry: HarnessRegistry['Service'], name: string) =>
  registry.resolve(name as HarnessId).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));

const nativeSeat = (models: ModelCatalog, to: HarnessMoveTo): KernelSeat => ({
  transport: NATIVE_BINDING,
  capabilities: nativeCapabilities(models, to.provider, to.model),
  selection: { provider: to.provider, model: to.model, reasoning: to.reasoning },
  account: to.account ?? null,
  switches: to.switches ?? {},
});

export const makeHarnessMoves = Effect.fnUntraced(function* ({
  releasing,
  handed,
  models,
}: {
  readonly releasing: ReleaseThread;
  readonly handed: (threadId: string) => Effect.Effect<void, HarnessFailure>;
  readonly models: () => ModelCatalog;
}) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const records = yield* ThreadRecords;
  const registry = yield* HarnessRegistry;
  const sessionOf = yield* SessionRead;
  const runs = yield* ThreadRunning;
  const rebinding = yield* ThreadRebinding;
  const admission = yield* RunAdmission;
  const handing = writes('HarnessMoves.handover', [thread, externalSession], records.writes, rebinding.writes);

  const handover = Effect.fn('HarnessMoves.handover')(function* (
    threadId: string,
    record: ThreadRecordFacts,
    hosts: string,
    facet: ExternalSession | null,
    target: HarnessSeated | null,
    to: HarnessMoveTo,
  ) {
    if ((yield* runs.runningRunOf(threadId)) !== null) return yield* running(threadId);
    const leaving = facet === null ? null : yield* resolved(registry, facet.name);
    if (leaving !== null) yield* releasing(threadId);
    const seat = target?.seat ?? null;
    const recorded = yield* rebinding.prepare(
      threadId,
      facet === null ? 'native' : 'acp',
      seat === null ? nativeSeat(models(), to) : seat.kernel,
    );
    const moved = yield* units.write(
      registry.writes(handing),
      Effect.fnUntraced(function* (unit) {
        if ((yield* runs.runningRun(threadId, unit)) !== null) return yield* running(threadId);
        const standing = yield* sessionOf(threadId, unit);
        if (standing?.name !== facet?.name) {
          return yield* new GateRefusal('harness-moved', `Thread ${threadId} moved to another harness while this move was taken.`, [
            'read the thread, then choose its model again',
          ]);
        }
        if (standing !== null) {
          if (standing.retiring === true)
            return yield* new GateRefusal('session-deleting', 'This thread is being deleted.', ['finish deleting it']);
          if (harnessSessionActive(standing.session)) {
            return yield* new GateRefusal('session-uncertain', `The agent process of ${threadId} has not ended, so it cannot move yet.`, [
              'read the thread state',
              'choose the model again once its process ended',
            ]);
          }
        }
        if (seat !== null) {
          if (record.projectId === null)
            return yield* new GateRefusal(
              'thread-project-missing',
              `Thread ${threadId} works no project, and a hosted agent runs in one.`,
              ['choose a model of a native provider'],
            );
          const mandate = yield* unit.run(
            db.select({ hostKind: mandateFacts.hostKind }).from(mandateFacts).where(eq(mandateFacts.id, threadId)).get(),
          );
          if (mandate?.hostKind != null)
            return yield* new GateRefusal('harness-host', 'A hosted agent runs in the local project workspace.', [
              'choose a model of a native provider',
            ]);
        }
        const native = yield* unit.run(
          db
            .select({ provider: thread.provider, model: thread.model, reasoning: thread.reasoning })
            .from(thread)
            .where(eq(thread.id, threadId))
            .get(),
        );
        if (native === undefined)
          return yield* new GateRefusal(
            'model-pinned',
            `Thread ${threadId} keeps no journal of its own, so another harness cannot continue it.`,
            ['start a new agent on the model you need, with this one’s report as its brief'],
          );
        if (standing !== null) {
          if (leaving?.release !== undefined) yield* leaving.release(threadId, unit);
          yield* deleteSession(db, unit, threadId);
        }
        if (seat !== null) yield* insertSession(db, unit, threadId, seat.facet);
        yield* records.harnessed(unit, threadId, {
          harness: target?.name ?? NATIVE_HARNESS,
          agentId: seat === null ? hosts : HARNESS_AGENT_ID,
        });
        if (recorded !== null) yield* recorded(unit);
        const from: ThreadModelSelection | null = servedSelection(
          native.provider,
          native.model === null && standing === null ? { model: 'default', reasoning: native.reasoning } : native,
          standing,
        );
        return { from, to: { provider: to.provider, model: to.model, reasoning: to.reasoning } } satisfies HarnessMoved;
      }),
    );
    yield* handed(threadId);
    return moved;
  });

  const within = Effect.fn('HarnessMoves.within')(function* (threadId: string, facet: ExternalSession, to: HarnessMoveTo) {
    const harness = yield* resolved(registry, facet.name);
    if (harness.move === undefined) return yield* pinned(threadId, facet.name);
    if (to.account !== undefined) {
      const selected = yield* units.read((unit) =>
        unit.run(db.select({ account: thread.account }).from(thread).where(eq(thread.id, threadId)).get()),
      );
      const chosen = selected?.account ?? null;
      if (to.account === chosen) return yield* harness.move(threadId, { ...to, account: undefined });
      if (to.account !== (facet.session?.account?.key ?? chosen)) {
        if ((yield* runs.runningRunOf(threadId)) !== null) return yield* running(threadId);
        yield* releasing(threadId);
      }
    }
    return yield* harness.move(threadId, to);
  });

  const kept = (threadId: string, to: HarnessMoveTo) =>
    Effect.map(
      units.read((unit) => switchesOf(db, unit, threadId)),
      (stored) => {
        const catalog = models();
        const option = catalog.registered(to.provider) ? catalog.modelsOf(to.provider).find((one) => one.id === to.model) : undefined;
        return keptSwitches(option?.switches ?? [], stored);
      },
    );

  const held = <A, E>(threadId: string, work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.acquireUseRelease(
      Effect.sync(() => admission.hold([threadId])),
      () => work,
      (lift) => Effect.sync(() => lift()),
    );

  return HarnessMoves.of({
    move: Effect.fn('HarnessMoves.move')(
      function* (threadId, asked) {
        const to = { ...asked, switches: asked.switches ?? (yield* kept(threadId, asked)) };
        const facet = yield* sessionOf(threadId);
        const bound = facet === null ? undefined : yield* units.read((unit) => bindingOf(db, unit, threadId));
        const capabilities = facet === null ? undefined : yield* units.read((unit) => capabilitiesOf(db, unit, threadId));
        if (facet !== null && capabilities?.modelMove === 'pinned') return yield* pinned(threadId, facet.name);
        if (facet !== null && bound?.agent == null) return yield* within(threadId, facet, to);
        const road = yield* registry.seating(to, models());
        if (facet === null && road === null) return null;
        if (facet !== null && facet.name === road?.name) return yield* within(threadId, facet, to);
        const record = yield* records.facts(threadId);
        if (record === undefined)
          return yield* new GateRefusal('thread-gone', `Thread ${threadId} is gone.`, ['name a thread that stands']);
        const hosts = bound?.agent ?? record.agentId;
        const seat = road === null ? null : { name: road.name, seat: yield* road.seat(hosts) };
        return yield* handover(threadId, record, hosts, facet, seat, to).pipe(
          Effect.retry({ times: STALE_RETRIES, while: (failure) => failure instanceof HarnessTurnStale }),
          Effect.mapError((failure) =>
            failure instanceof HarnessTurnStale ? new GateRefusal(JOURNAL_MOVED, failure.message, ['choose the model again']) : failure,
          ),
        );
      },
      (work, threadId) => held(threadId, work),
    ),
  });
});

export const harnessModels = (native: ThreadModel['Service'], moves: HarnessMoves['Service']): ThreadModel['Service'] =>
  ThreadModel.of({
    ...native,
    move: (threadId, input) => {
      const act = moves
        .move(threadId, { provider: input.option.provider, model: input.option.id, reasoning: input.reasoning })
        .pipe(
          Effect.mapError((cause) =>
            cause instanceof GateRefusal
              ? cause.code === 'thread-running' || cause.code === 'model-pinned'
                ? new ThreadModelRefused({ threadId, reason: cause.code })
                : new ThreadCallBroke({ cause })
              : cause instanceof ThreadCallBroke || cause instanceof ThreadStorageFailed
                ? cause
                : new ThreadStorageFailed({ call: 'harness.move', cause }),
          ),
        );
      return native
        .adapted(threadId, input, act)
        .pipe(Effect.flatMap((moved) => (moved === null ? native.move(threadId, input) : Effect.succeed(moved))));
    },
  });
