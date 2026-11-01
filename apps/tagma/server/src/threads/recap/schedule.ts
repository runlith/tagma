import type { AgentAside, AgentAsideAnswer } from '@runlith/agent/AgentAside';
import { AgentAsideCalledTool } from '@runlith/agent/AgentAside';
import { activity, body, note, type ActivityPlacement, type ActivityEnding } from '@runlith/activity/Activity';
import { activityKind } from '@runlith/activity/fact';
import { ActivityLog } from '@runlith/activity/log';
import { ActivityCause } from '@runlith/activity/cause';
import { and, eq } from 'drizzle-orm';
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Option, Predicate } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { Settings } from '../../settings/contract/service/values.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { ThreadRecap } from '../../thread-record/contract/wire/recap.js';
import { recordRows, threadRecord } from '../../thread-record/store/table.js';
import { ThreadJournal } from '../contract/service/engine.js';
import { CacheWarmth } from '../contract/service/evidence.js';
import { ThreadRecaps } from '../contract/service/recaps.js';
import { ThreadLookup } from '../contract/service/reads.js';
import { cacheWarmthOf } from '../list/wire.js';
import { threadQuietRun } from '../store/conversation.js';
import { thread, threadRun } from '../store/kernel.js';
import { recap as recapKey } from '../contract/wire/settings.js';
import { readRecap, recapInstruction } from './prompt.js';
import { document, makeRecapQuestions } from './questions.js';
import { askGate, AskRefused, type ModelSelection } from '../../providers/contract/service/asks.js';
import { automaticRecaps } from './readings.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { RecapAttempt } from '../contract/wire/recap.js';
import { endingRefusal, recapRefusal, refusedAt } from './refusals.js';
import { answeredTwice, coveredAmong, type CoveredMessage, indexedThrough, latestSaid, readerItem, readerWaiting } from './standing.js';

const READER_TURN = 'message:user:';
const REWRITING_KINDS = ['compaction', 'pruning', 'rewind', 'restore', 'withdrawal', 'message'];
const REWRITING_PAGE = 200;

type CaptureBasis = {
  readonly projectId: number;
  readonly covered: CoveredMessage;
  readonly head: number;
  readonly runId: string | null;
  manualRequested: boolean;
};

type Capture = { readonly basis: CaptureBasis; readonly copy: AgentAside; readonly deadline?: number };

type Pending = {
  readonly capture: Capture;
  readonly manual: boolean;
  readonly ready: Deferred.Deferred<Fiber.Fiber<string | null, unknown>>;
  phase: 'waiting' | 'writing';
  shown?: RecapAttempt;
};

export type RecapTiming = {
  readonly waitMs: number;
  readonly marginMs: number;
  readonly idleMs: number;
};

type RecapResult = { readonly effect: 'published' | 'skipped' | 'superseded'; readonly reason?: string };

export const RECAP = activityKind<Record<never, never>, RecapResult>('recap');

export type RecapSkip = 'disabled' | 'gone' | 'running' | 'index-behind' | 'moved' | 'rewritten' | 'selection' | 'cold';

export const makeRecapSchedule = Effect.fnUntraced(function* ({
  published,
  progressed,
  timing,
}: {
  readonly published: (threadId: string) => Effect.Effect<void, unknown>;
  readonly progressed: (threadId: string) => Effect.Effect<void, unknown>;
  readonly timing: RecapTiming;
}) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const records = yield* ThreadRecords;
  const settings = yield* Settings;
  const journal = yield* ThreadJournal;
  const recaps = yield* ThreadRecaps;
  const threads = yield* ThreadLookup;
  const warmth = yield* CacheWarmth;
  const questions = yield* makeRecapQuestions;
  const log = yield* ActivityLog;
  const scope = yield* Effect.scope;
  const pending = new Map<string, Pending>();
  const captures = new Map<string, CaptureBasis>();

  const logged = (what: string, threadId: string, work: Effect.Effect<void, unknown>) =>
    Effect.flatMap(Effect.exit(work), (exit) =>
      Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
        ? Effect.logWarning(what, { threadId, cause: Cause.pretty(exit.cause) })
        : Effect.void,
    );

  const shown = (threadId: string, attempt: RecapAttempt | null) =>
    Effect.suspend(() => {
      recaps.track(threadId, attempt);
      return logged('the recap attempt was not published', threadId, progressed(threadId));
    });

  const show = (threadId: string, slot: Pending) => {
    const attempt: RecapAttempt = { state: 'writing', entryId: slot.capture.basis.covered.entryId };
    slot.shown = attempt;
    return shown(threadId, attempt);
  };

  const ended = (threadId: string, slot: Pending, exit: Exit.Exit<string | null, unknown>) =>
    Effect.suspend(() => {
      const attempt = slot.shown;
      if (attempt === undefined || recaps.attempt(threadId) !== attempt) return Effect.void;
      const refusal = endingRefusal(exit, slot.manual);
      return shown(threadId, refusal === null ? null : refusedAt(attempt.entryId, refusal));
    });

  const refused = Effect.fnUntraced(function* (threadId: string, basis: CaptureBasis | undefined, reason: string) {
    const refusal = recapRefusal(reason);
    const entryId = basis?.covered.entryId ?? (yield* units.read((unit) => latestSaid(db, unit, threadId)))?.entryId;
    if (entryId !== undefined && recaps.attempt(threadId)?.state !== 'writing') yield* shown(threadId, refusedAt(entryId, refusal));
    return yield* refusal;
  });

  const cancelOwned = Effect.fnUntraced(function* (threadId: string, slot: Pending) {
    if (pending.get(threadId) === slot) pending.delete(threadId);
    yield* Fiber.interrupt(yield* Deferred.await(slot.ready));
  });

  const cancel = (threadId: string) =>
    Effect.suspend(() => {
      const slot = pending.get(threadId);
      return slot === undefined ? Effect.void : cancelOwned(threadId, slot);
    });

  const observed = <A, E, R>(threadId: string, placement: ActivityPlacement, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.flatMap(ActivityCause, (cause) =>
      Effect.provideService(
        activity(RECAP, {}, work, {
          thread: threadId,
          actor: cause?.actor ?? { kind: 'operator' },
          trigger: cause?.trigger ?? null,
          ...placement,
          ended: (exit): ActivityEnding<RecapResult> => {
            if (Exit.isFailure(exit)) {
              const failure = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
              if (failure instanceof GateRefusal)
                return {
                  outcome: 'refused',
                  reason: failure.code,
                  message: failure.message,
                  result: { effect: 'skipped' as const, reason: failure.code },
                };
              return { result: { effect: 'skipped' as const, reason: Cause.hasInterruptsOnly(exit.cause) ? 'cancelled' : 'failed' } };
            }
            const reason = typeof exit.value === 'string' ? exit.value : null;
            return {
              outcome: reason === null || reason === 'superseded' ? undefined : ('refused' as const),
              reason: reason === null || reason === 'superseded' ? undefined : reason,
              result: {
                effect: reason === null ? 'published' : reason === 'superseded' ? 'superseded' : 'skipped',
                reason: reason ?? undefined,
              },
            };
          },
        }),
        ActivityLog,
        log,
      ),
    );

  const rewritten = Effect.fnUntraced(function* (threadId: string, held: Capture, head: number, unit: Unit<'machine'>) {
    let after = held.basis.covered.position;
    while (after < head) {
      const rows = yield* journal.recordsAsOf(
        threadId,
        { head, afterPosition: after, limit: REWRITING_PAGE, kinds: REWRITING_KINDS },
        unit,
      );
      if (rows.some((row) => row.kind !== 'message')) return true;
      const replaced = rows.flatMap((row) => {
        const id = (row.payload as { readonly entry?: { readonly id?: unknown } }).entry?.id;
        return typeof id === 'string' ? [id] : [];
      });
      if (yield* coveredAmong(db, unit, threadId, replaced, held.basis.covered.appeared)) return true;
      if (rows.length < REWRITING_PAGE) return false;
      after = rows[rows.length - 1]!.position;
    }
    return false;
  });

  const standing = (threadId: string, held: Capture, unit?: Unit<'machine'>) => {
    const check = Effect.fnUntraced(function* (read: Unit<'machine'>) {
      const head = yield* journal.headPosition(threadId, read);
      if (!(yield* indexedThrough(db, read, threadId, head))) return 'index-behind' satisfies RecapSkip;
      if ((yield* latestSaid(db, read, threadId))?.appeared !== held.basis.covered.appeared) return 'moved' satisfies RecapSkip;
      if (yield* readerWaiting(db, read, threadId)) return 'moved' satisfies RecapSkip;
      return (yield* rewritten(threadId, held, head, read)) ? ('rewritten' satisfies RecapSkip) : null;
    });
    return unit === undefined ? units.read(check) : check(unit);
  };

  const promised = Effect.fnUntraced(function* (threadId: string) {
    const current = yield* threads.summary(threadId);
    if (current === undefined) return false;
    const verdict = cacheWarmthOf(current, false, yield* warmth.warmthBasis([current]));
    return verdict?.state === 'warm' && verdict.basis === 'promise';
  });

  const unfit = Effect.fnUntraced(function* (threadId: string, held: Capture, manual: boolean) {
    if (!manual && !(yield* automaticRecaps(settings, held.basis.projectId))) return 'disabled' satisfies RecapSkip;
    const standingNow = yield* standing(threadId, held);
    if (standingNow !== null) return standingNow;
    const chosen = yield* questions.selection(threadId, held.copy);
    if (typeof chosen === 'string') return chosen;
    return manual || (yield* promised(threadId)) ? null : ('cold' satisfies RecapSkip);
  });

  const publish = Effect.fnUntraced(function* (threadId: string, slot: Pending, selected: ModelSelection, written: ThreadRecap) {
    const held = slot.capture;
    const enabled = slot.manual ? () => true : yield* settings.held(recapKey, held.basis.projectId);
    return yield* units.write(writes('ThreadRecap.publish', [recordRows]), (unit) =>
      Effect.gen(function* () {
        const facts = yield* records.facts(threadId, unit);
        if (facts === undefined || facts.projectId !== held.basis.projectId || facts.status === 'running' || facts.runningRunId !== null)
          return 'superseded' as const;
        if (held.copy.source === 'capture') {
          const current = yield* unit.run(
            db
              .select({ provider: thread.provider, model: thread.model, reasoning: thread.reasoning, account: thread.account })
              .from(thread)
              .where(eq(thread.id, threadId))
              .get(),
          );
          if (
            current === undefined ||
            current.provider !== selected.provider ||
            current.model !== selected.model ||
            current.reasoning !== selected.reasoning ||
            current.account !== selected.account
          )
            return 'selection' as const;
        }
        if ((yield* standing(threadId, held, unit)) !== null) return 'superseded' as const;
        if (pending.get(threadId) !== slot || captures.get(threadId) !== held.basis) return 'superseded' as const;
        if (!enabled()) return 'disabled' as const;
        return (yield* records.writeRecap(unit, threadId, written)) ? null : ('superseded' as const);
      }),
    );
  });

  const asked = Effect.fnUntraced(function* (threadId: string, slot: Pending, prior: Parameters<typeof recapInstruction>[0]) {
    const held = slot.capture;
    const posed = yield* questions.posed(threadId, held.copy, recapInstruction(prior), {
      journalHead: held.basis.head,
      position: held.basis.covered.appeared,
      entryId: held.basis.covered.entryId,
      run: held.basis.runId,
    });
    const answer = yield* Effect.exit(posed.ask.pipe(Effect.timeout(timing.idleMs)));
    if (answer._tag === 'Failure') {
      if (Cause.hasInterruptsOnly(answer.cause)) return yield* Effect.interrupt;
      const failure = Option.getOrUndefined(Cause.findErrorOption(answer.cause));
      if (failure instanceof AskRefused) {
        yield* recorded(threadId, failure.refusal, undefined, failure.message);
        return yield* askGate(failure, ['check the provider connection and try /recap again']);
      }
      if (failure instanceof GateRefusal) return yield* failure;
      const reason =
        failure instanceof AgentAsideCalledTool ? 'tool-call' : Predicate.isTagged(failure, 'TimeoutError') ? 'timeout' : 'model-failed';
      yield* recorded(threadId, reason, failure instanceof AgentAsideCalledTool ? failure : undefined, String(Cause.squash(answer.cause)));
      if (reason === 'model-failed')
        return yield* new GateRefusal(
          'recap-model-failed',
          failure instanceof Error ? failure.message : 'The model request failed while writing the recap.',
          ['check the provider connection and try /recap again'],
        );
      return reason;
    }
    const read = readRecap(answer.value.text);
    if (read.kind === 'failed') {
      yield* recorded(threadId, read.reason, answer.value);
      return read.reason;
    }
    const chosen = yield* posed.selected;
    if (typeof chosen === 'string') {
      yield* recorded(threadId, chosen, answer.value);
      return chosen;
    }
    const origin = held.copy.binding.origin;
    const stopped = yield* publish(threadId, slot, chosen, {
      summary: read.summary,
      next: read.next,
      voided: false,
      basis: {
        position: held.basis.covered.appeared,
        entryId: held.basis.covered.entryId,
        runId: held.basis.covered.runId ?? held.copy.runId ?? held.basis.runId ?? '',
        journalHead: held.basis.head,
        generatedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
        provider: origin?.provider ?? chosen.provider,
        model: origin?.model ?? chosen.model ?? '',
      },
    });
    yield* recorded(threadId, stopped, answer.value);
    return stopped;
  });

  const generate = Effect.fnUntraced(
    function* (threadId: string, slot: Pending) {
      const held = slot.capture;
      const manual = slot.manual;
      if (pending.get(threadId) !== slot) return 'superseded';
      slot.phase = 'writing';
      if (manual) yield* show(threadId, slot);
      const skip = yield* unfit(threadId, held, manual);
      const copy = held.copy;
      yield* note({
        type: 'model-chosen',
        road: skip === null ? 'warm' : 'none',
        rejected: skip === null ? [] : [{ road: 'warm', reason: skip }],
        ...copy.binding.origin,
        rung: copy.reasoning,
        account: copy.binding.account ?? null,
      });
      if (skip !== null) return skip;
      if (!manual) yield* show(threadId, slot);
      const prior = (yield* recaps.readings([{ id: threadId, projectId: held.basis.projectId }])).get(threadId);
      const failed = yield* asked(threadId, slot, prior);
      if (failed !== null) return failed;
      if (recaps.attempt(threadId) === slot.shown) recaps.track(threadId, null);
      yield* published(threadId);
      return null;
    },
    (work, threadId, slot) =>
      work.pipe(
        Effect.onExit((exit) => ended(threadId, slot, exit)),
        Effect.ensuring(
          Effect.sync(() => {
            if (pending.get(threadId) === slot) pending.delete(threadId);
          }),
        ),
      ),
  );

  const loggedGeneration = (threadId: string, slot: Pending) =>
    Effect.flatMap(Effect.exit(generate(threadId, slot)), (exit) => {
      if (Exit.isSuccess(exit)) return Effect.succeed(exit.value);
      if (Cause.hasInterruptsOnly(exit.cause)) return Effect.interrupt;
      return Effect.andThen(
        Effect.logWarning('the recap was not written', { threadId, cause: Cause.pretty(exit.cause) }),
        Effect.succeed('model-failed'),
      );
    });

  const launch = (threadId: string, capture: Capture, manual: boolean): Effect.Effect<Pending | 'running' | 'moved'> =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const ready = yield* Deferred.make<Fiber.Fiber<string | null, unknown>>();
        const slot: Pending = { capture, manual, ready, phase: manual ? 'writing' : 'waiting' };
        const previous = yield* Effect.sync(() => {
          if (captures.get(threadId) !== capture.basis) return 'moved' as const;
          const held = pending.get(threadId);
          if (held !== undefined && (!manual || held.phase === 'writing')) return 'running' as const;
          if (!manual && capture.basis.manualRequested) return 'moved' as const;
          if (manual) capture.basis.manualRequested = true;
          pending.set(threadId, slot);
          return held;
        });
        if (typeof previous === 'string') return previous;
        if (previous !== undefined) yield* cancelOwned(threadId, previous);
        const now = yield* Clock.currentTimeMillis;
        const opened = yield* Deferred.make<void>();
        const work = manual
          ? generate(threadId, slot)
          : observed(
              threadId,
              {
                ...placed(capture.basis.runId),
                actor: { kind: 'server', name: 'recap-schedule' },
                trigger: { kind: 'recap-schedule', refs: [capture.basis.runId ?? threadId, new Date(capture.deadline!).toISOString()] },
              },
              Effect.andThen(
                Deferred.succeed(opened, undefined),
                Effect.andThen(Effect.sleep(Math.max(0, capture.deadline! - now)), loggedGeneration(threadId, slot)),
              ),
            );
        const fiber = yield* Effect.forkIn(Effect.interruptible(work), scope);
        yield* Deferred.succeed(ready, fiber);
        if (!manual) {
          const started = yield* Effect.raceFirst(Effect.as(Deferred.await(opened), true), Effect.as(Fiber.await(fiber), false));
          if (!started) {
            if (pending.get(threadId) === slot) pending.delete(threadId);
            return 'moved' as const;
          }
        }
        return slot;
      }),
    );

  const quiet = (threadId: string, runId: string) =>
    units.read((unit) =>
      Effect.map(
        unit.run(
          db
            .select({ runId: threadQuietRun.runId })
            .from(threadQuietRun)
            .where(and(eq(threadQuietRun.threadId, threadId), eq(threadQuietRun.runId, runId)))
            .get(),
        ),
        (row) => row !== undefined,
      ),
    );

  const spokeHere = (threadId: string, readerInput: string) =>
    units.read((unit) =>
      readerInput.startsWith(READER_TURN)
        ? Effect.map(
            unit.run(
              db
                .select({ id: threadRun.id })
                .from(threadRun)
                .where(and(eq(threadRun.id, readerInput.slice(READER_TURN.length)), eq(threadRun.threadId, threadId)))
                .get(),
            ),
            (row) => row !== undefined,
          )
        : readerItem(db, unit, threadId, readerInput),
    );

  return {
    opened: (threadId: string, _runId: string, keepWarm: boolean) => {
      if (keepWarm) return Effect.void;
      captures.delete(threadId);
      recaps.track(threadId, null);
      return cancel(threadId);
    },

    forgotten: (threadId: string) => {
      captures.delete(threadId);
      recaps.track(threadId, null);
      return cancel(threadId);
    },

    settled: (threadId: string, aside: AgentAside) => {
      const readerInput = aside.readerInput;
      if (aside.measuredAt === null) return Effect.void;
      return logged(
        'the recap was not scheduled',
        threadId,
        Effect.gen(function* () {
          const projectId = yield* records.projectOf(threadId);
          if (projectId == null) return;
          if (yield* quiet(threadId, aside.runId)) return;
          const head = yield* journal.headPosition(threadId);
          const read = yield* units.read((unit) =>
            Effect.all({
              whole: indexedThrough(db, unit, threadId, head),
              covered: latestSaid(db, unit, threadId),
              exchanged: answeredTwice(db, unit, threadId),
            }),
          );
          const covered = read.covered;
          if (!read.whole || covered === undefined) return;
          const existing = captures.get(threadId);
          const basis =
            existing?.runId === aside.runId && existing.head === head && existing.covered.position === covered.position
              ? existing
              : { projectId, covered, head, runId: aside.runId, manualRequested: false };
          const previous = pending.get(threadId);
          captures.set(threadId, basis);
          if (previous !== undefined && previous.capture.basis !== basis) yield* cancelOwned(threadId, previous);
          const capture = { basis, copy: aside };
          if (!read.exchanged || readerInput === null || aside.expiresAt === null || !(yield* automaticRecaps(settings, projectId))) return;
          if (!(yield* spokeHere(threadId, readerInput))) return;
          const prior = (yield* recaps.readings([{ id: threadId, projectId }])).get(threadId);
          if (prior?.status === 'current') return;
          const now = yield* Clock.currentTimeMillis;
          const deadline = Math.min(now + timing.waitMs, aside.expiresAt - timing.marginMs);
          if (deadline <= now) return;
          yield* launch(threadId, { ...capture, deadline }, false);
        }),
      );
    },

    generateNow: Effect.fnUntraced(
      function* (threadId: string, projectId: number) {
        const heldProject = yield* records.projectOf(threadId);
        if (heldProject === undefined) return yield* recapRefusal('gone');
        if (heldProject !== projectId)
          return yield* new GateRefusal('foreign-project', 'This thread belongs to another project.', [
            'open the thread in its own project',
          ]);
        const standingBasis = captures.get(threadId);
        return yield* observed(
          threadId,
          placed(standingBasis?.runId ?? null),
          Effect.gen(function* () {
            const facts = yield* records.facts(threadId);
            if (facts?.status === 'running' || facts?.runningRunId != null) return yield* refused(threadId, standingBasis, 'running');
            const copy = standingBasis === undefined ? undefined : (pending.get(threadId)?.capture.copy ?? questions.held(threadId));
            if (standingBasis === undefined || copy === undefined || copy.runId !== standingBasis.runId)
              return yield* refused(threadId, standingBasis, 'not-warm');
            const capture: Capture = { basis: standingBasis, copy };
            const basis = capture.basis;
            yield* Effect.acquireUseRelease(
              Effect.flatMap(launch(threadId, capture, true), (slot) =>
                typeof slot === 'string' ? refused(threadId, basis, slot) : Effect.succeed(slot),
              ),
              Effect.fnUntraced(function* (slot) {
                const fiber = yield* Deferred.await(slot.ready);
                const answer = yield* Effect.exit(Fiber.join(fiber));
                if (Exit.isFailure(answer)) {
                  if (Cause.hasInterruptsOnly(answer.cause)) return yield* recapRefusal('moved');
                  return yield* Effect.failCause(answer.cause);
                }
                if (answer.value !== null) return yield* recapRefusal(answer.value);
              }),
              (slot) => cancelOwned(threadId, slot),
            );
            const recap = (yield* recaps.readings([{ id: threadId, projectId }])).get(threadId);
            if (recap === undefined) return yield* recapRefusal('gone');
            return recap;
          }),
        );
      },
      (work) =>
        work.pipe(
          Effect.mapError((failure) =>
            failure instanceof GateRefusal ? failure : new ThreadStorageFailed({ call: 'ThreadRecap.generate', cause: failure }),
          ),
        ),
    ),
  };
});

const placed = (runId: string | null): ActivityPlacement => (runId === null ? {} : { run: runId, parent: { run: runId } });

const recorded = (threadId: string, failure: string | null, answer?: AgentAsideAnswer, detail?: string) =>
  Effect.asVoid(
    body(
      document('response', {
        threadId,
        reason: failure ?? undefined,
        ...answer,
        failure: detail,
      }),
    ),
  );
