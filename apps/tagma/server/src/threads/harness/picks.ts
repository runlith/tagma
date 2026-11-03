import { eq } from 'drizzle-orm';
import { Cause, Clock, Context, Effect, Exit, type Fiber, FiberMap, References, Schedule, Semaphore, Tracer } from 'effect';
import { ThreadModelRefused } from '@runlith/agent/collaboration/model';
import type { ThreadStopReceipt } from '@runlith/agent/collaboration/runs';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { RunAdmission } from '@runlith/agent/thread/run/runAdmission';
import { ThreadMissing } from '@runlith/agent/thread/ThreadBorder';
import { Maintenance } from '../../platform/contract/service/maintenance.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ThreadHarness } from '../contract/service/engine.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import type { HarnessMoved, HarnessMoveTo } from '../contract/service/harness.js';
import { JOURNAL_MOVED } from '../contract/service/rebinding.js';
import { ThreadRollouts } from '../contract/service/rollouts.js';
import type { NativeThreadSnapshot } from '../contract/service/state.js';
import { PICK_ENTRY, type ModelPick, type PickEntry, type ThreadPick } from '../contract/wire/harness/pick.js';
import { nativeRows, thread } from '../store/kernel.js';
import { dropPick, keepPick, pickedThreads, pickOf } from '../store/seat.js';

type Hold = (wake?: boolean) => void;

type Lane = { readonly lock: Semaphore.Semaphore; users: number };

const AGAIN: ReadonlySet<string> = new Set(['thread-running', 'session-starting', 'session-uncertain', 'harness-moved', JOURNAL_MOVED]);

const GONE: ReadonlySet<string> = new Set(['thread-gone', 'session-deleting']);

const again = (failure: unknown): boolean =>
  (failure instanceof ThreadModelRefused && failure.reason === 'step-unreached') ||
  (failure instanceof GateRefusal && AGAIN.has(failure.code)) ||
  (failure instanceof ThreadStorageFailed && failure.call === 'model.resume');

const gone = (failure: unknown): boolean => failure instanceof ThreadMissing || (failure instanceof GateRefusal && GONE.has(failure.code));

const running = (failure: unknown): boolean => failure instanceof GateRefusal && failure.code === 'thread-running';

export const PICK_REPLACED = 'pick-replaced';

const replaced = (failure: unknown): boolean => failure instanceof GateRefusal && failure.code === PICK_REPLACED;

const reasonOf = (cause: Cause.Cause<unknown>): string => {
  const failure = Cause.squash(cause);
  if (failure instanceof GateRefusal) return failure.reason;
  return failure instanceof Error ? failure.message : String(failure);
};

const chosen = (pick: ModelPick): ModelPick => ({
  provider: pick.provider,
  model: pick.model,
  reasoning: pick.reasoning,
  account: pick.account,
  switches: pick.switches,
});

export const makePicks = Effect.fnUntraced(function* ({
  move,
  harness,
}: {
  readonly move: (threadId: string, to: HarnessMoveTo) => Effect.Effect<HarnessMoved | null, HarnessFailure>;
  readonly harness: Effect.Effect<ThreadHarness['Service']>;
}) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const admission = yield* RunAdmission;
  const rollouts = yield* ThreadRollouts;
  const { opened } = yield* Maintenance;
  const carriers = yield* FiberMap.make<string>();
  const lifetime = Context.omit(Tracer.ParentSpan, References.CurrentStackFrame)(yield* Effect.context<never>());
  const lanes = new Map<string, Lane>();
  const keeping = writes('HarnessMoves.pick', [nativeRows]);

  const laned = <A, E>(threadId: string, work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const lane = lanes.get(threadId) ?? { lock: Semaphore.makeUnsafe(1), users: 0 };
        lane.users += 1;
        lanes.set(threadId, lane);
        return lane;
      }),
      (lane) => lane.lock.withPermits(1)(work),
      (lane) =>
        Effect.sync(() => {
          lane.users -= 1;
          if (lane.users === 0 && lanes.get(threadId) === lane) lanes.delete(threadId);
        }),
    );

  const land = Effect.fn('HarnessMoves.land')(function* (threadId: string, pick: ModelPick, pending?: string) {
    const moved = yield* move(threadId, { ...chosen(pick), pending });
    if (moved !== null) return { to: moved.to, snapshot: null };
    const snapshot = yield* (yield* harness).threads.handle(threadId, OPERATOR_PRINCIPAL).setModelSettings(chosen(pick));
    yield* rollouts.appendMeta(threadId);
    return { to: { provider: pick.provider, model: pick.model, reasoning: pick.reasoning }, snapshot };
  });

  const carried = Effect.fnUntraced(function* (threadId: string, resume: string | undefined) {
    const pick = yield* units.read((unit) => pickOf(db, unit, threadId));
    const landed = pick === null ? null : yield* land(threadId, pick, pick.id).pipe(Effect.catchIf(replaced, () => Effect.succeed(null)));
    if (landed !== null) return { ...landed, resume };
    if (resume === undefined) return null;
    const row = yield* units.read((unit) =>
      unit.run(
        db
          .select({ provider: thread.provider, model: thread.model, reasoning: thread.reasoning })
          .from(thread)
          .where(eq(thread.id, threadId))
          .get(),
      ),
    );
    if (row === undefined) return yield* new GateRefusal('thread-gone', `Thread ${threadId} is gone.`, ['name a thread that stands']);
    return { to: { provider: row.provider, model: row.model ?? 'default', reasoning: row.reasoning }, resume };
  });

  const stoppedOf = Effect.fnUntraced(function* (threadId: string) {
    const latest = yield* (yield* harness).runs.ledger().latestRun(threadId);
    const stopped: ThreadStopReceipt | null =
      latest !== null && latest.status === 'aborted' && latest.settledBy === 'model' ? { status: 'stopped', runId: latest.id } : null;
    return stopped;
  });

  const attempt = Effect.fnUntraced(function* (threadId: string, holding: Hold | undefined) {
    const kernel = yield* harness;
    const stopped = yield* stoppedOf(threadId);
    return yield* kernel.threads.handle(threadId, OPERATOR_PRINCIPAL).carryModel({
      threadId,
      request: { key: crypto.randomUUID(), deadline: new Date(yield* Clock.currentTimeMillis) },
      until: 'boundary',
      holding,
      stopped,
      move: (resume) => carried(threadId, resume),
      running,
      restoreOnFailure: true,
    });
  });

  const refused = Effect.fn('HarnessMoves.pickRefused')(function* (threadId: string, cause: Cause.Cause<unknown>) {
    const kernel = yield* harness;
    const pick = yield* units.read((unit) => pickOf(db, unit, threadId));
    if (pick !== null) {
      const entry: PickEntry = {
        type: PICK_ENTRY,
        id: `model-pick:${pick.id}`,
        provider: pick.provider,
        model: pick.model,
        reasoning: pick.reasoning,
        reason: reasonOf(cause),
        occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      };
      yield* kernel.threads.handle(threadId, OPERATOR_PRINCIPAL).append([{ kind: PICK_ENTRY, payload: { entry } }]);
      yield* units.write(keeping, (unit) => dropPick(db, unit, threadId, pick.id));
      yield* kernel.threads.publish(threadId);
    }
    if ((yield* stoppedOf(threadId)) !== null) yield* kernel.threads.handle(threadId, OPERATOR_PRINCIPAL).continue();
  });

  const carry = (threadId: string, holding: Hold | undefined): Effect.Effect<void, unknown> => {
    let handed = holding;
    const once = Effect.suspend(() => {
      const given = handed;
      handed = undefined;
      return attempt(threadId, given);
    });
    return once.pipe(
      Effect.tapError((failure) =>
        Effect.sync(() => {
          if (failure instanceof GateRefusal && AGAIN.has(failure.code)) handed = admission.hold([threadId]);
        }),
      ),
      Effect.retry({ schedule: Schedule.spaced('1 second'), while: again }),
      Effect.asVoid,
      Effect.catchIf(gone, () => Effect.void),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.andThen(
              Effect.logWarning('a picked model did not reach its thread', { threadId, cause }),
              refused(threadId, cause).pipe(
                Effect.tapCause((lost) =>
                  Effect.logWarning('a refused model pick stayed recorded on its thread', { threadId, cause: lost }),
                ),
              ),
            ),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          holding?.();
          handed?.();
        }),
      ),
    );
  };

  const start = (threadId: string, holding?: Hold): Effect.Effect<void> => {
    const forked: Effect.Effect<Fiber.Fiber<void, unknown>> = FiberMap.run(
      carriers,
      threadId,
      Effect.interruptible(carry(threadId, holding)),
    );
    return Effect.asVoid(Effect.updateContext(forked, (_context: Context.Context<never>) => lifetime));
  };

  const place = (threadId: string, asked: ModelPick): Effect.Effect<NativeThreadSnapshot, HarnessFailure> =>
    laned(
      threadId,
      Effect.uninterruptible(
        Effect.suspend(() => {
          const hold = admission.hold([threadId]);
          let standing: ThreadPick | null = null;
          let handed = false;
          return Effect.gen(function* () {
            const kernel = yield* harness;
            standing = yield* units.read((unit) => pickOf(db, unit, threadId));
            yield* FiberMap.remove(carriers, threadId);
            const landed =
              (yield* stoppedOf(threadId)) !== null
                ? null
                : yield* land(threadId, asked).pipe(Effect.catchIf(running, () => Effect.succeed(null)));
            if (landed !== null) return landed.snapshot ?? (yield* kernel.reads.snapshot(threadId));
            const pick: ThreadPick = { ...chosen(asked), id: crypto.randomUUID() };
            yield* units.write(keeping, (unit) => keepPick(db, unit, threadId, pick));
            handed = true;
            yield* start(threadId, hold);
            yield* kernel.threads.publish(threadId);
            return yield* kernel.reads.snapshot(threadId);
          }).pipe(
            Effect.onExit((exit) =>
              Effect.suspend(() => {
                if (handed) return Effect.void;
                if (Exit.isFailure(exit) && standing !== null) return start(threadId, hold);
                hold();
                return Effect.void;
              }),
            ),
          );
        }),
      ),
    );

  const resume = Effect.fn('HarnessMoves.resumePicks')(function* () {
    const picked = yield* units.read((unit) => pickedThreads(db, unit));
    yield* Effect.forEach(
      picked,
      (threadId) =>
        laned(
          threadId,
          Effect.flatMap(FiberMap.has(carriers, threadId), (held) => (held ? Effect.void : start(threadId))),
        ),
      { discard: true },
    );
  });

  yield* Effect.forkScoped(
    Effect.andThen(opened, resume()).pipe(
      Effect.tapCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logError('the model picks left pending before this start wait for the next start', cause),
      ),
    ),
  );

  return { place };
});
