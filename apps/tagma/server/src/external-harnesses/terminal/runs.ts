import { Cause, Duration, Effect, Exit, FiberMap, Option } from 'effect';
import type { RunOwnership, ThreadRunRef } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { ThreadRunStoppedBy } from '@runlith/agent/thread/ending';
import { carriesWords, opensTurn, queuedTurnText, spokenByAgent } from '@runlith/agent/thread/inboxItems';
import type { ThreadInboxItem } from '@runlith/agent/thread/storage/inbox';
import type { ThreadRunRow } from '@runlith/agent/thread/rows';
import type { ThreadInbox } from '../../threads/store/inbox.js';
import type { HostedResume, ThreadAbandonedRun } from '@runlith/agent/thread/storage/runs';
import { bordered, type ThreadPortFailure } from '@runlith/agent/thread/ThreadBorder';
import {
  type InterruptReceipt,
  LaunchFailed,
  type RunLaunch,
  type TransportRuns,
  type Withdrawal,
} from '@runlith/agent/thread/transport/contract';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { failedAs, type HarnessFailure } from '../../threads/contract/service/failure.js';
import type { ExternalSession, HarnessTypedShape, HarnessUnread } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessExecutionRef } from '../../threads/contract/wire/harness/observation.js';
import { harnessSessionActive } from '../../threads/contract/wire/harness/session.js';
import type { HarnessAdapters } from '../contract/service/adapters.js';
import { CONTINUE_WORDS, inputWords, plainWords, promptDigest, typedShape } from '../adapter/input.js';
import type { Keyboard, SessionDriver } from '../sessions/drive.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { TerminalEndings } from './endings.js';
import type { TerminalInterrupts } from './interrupts.js';
import type { TerminalJournal } from './journal.js';
import { WAITING_REASONS } from '../../threads/contract/wire/waiting.js';
import type { ComposerDrafts } from './drafts.js';
import type { OpenRuns } from './open.js';
import type { TerminalWatch } from './watch.js';
import { owedOf, unproven, type TerminalWords } from './words.js';

const reasonOf = (failure: unknown): string =>
  failure instanceof GateRefusal ? failure.reason : failure instanceof Error ? failure.message : String(failure);

type Delivery = {
  readonly items: readonly string[];
  readonly text: string;
  readonly spoken: string;
  readonly digest: string | undefined;
  readonly typed: HarnessTypedShape | undefined;
};

const framed = (seed: readonly ThreadInboxItem[]): Delivery => {
  const words = seed.flatMap((item) => {
    const text = carriesWords(item) ? queuedTurnText([item]) : '';
    return text.trim() === '' ? [] : [{ id: item.id, text }];
  });
  const text = words.map((word) => inputWords(word.id, word.text)).join('\n');
  return {
    items: words.map((word) => word.id),
    text,
    spoken: queuedTurnText(seed.filter((item) => opensTurn(item) && !spokenByAgent(item))),
    digest: undefined,
    typed: text === '' ? undefined : typedShape(text),
  };
};

const verbatim = (stored: readonly ThreadInboxItem[]): Delivery => {
  const words = stored.filter(carriesWords);
  const text = plainWords(words.map((item) => item.body.text).join('\n\n'));
  const said = words.filter((item) => !spokenByAgent(item));
  const spoken = said.length === words.length ? text : plainWords(said.map((item) => item.body.text).join('\n\n'));
  return {
    items: words.map((item) => item.id),
    text,
    spoken,
    digest: text === '' ? undefined : promptDigest(text),
    typed: text === '' ? undefined : typedShape(text),
  };
};

const deliveryOf = (facet: ExternalSession | null, items: readonly ThreadInboxItem[]): Delivery =>
  facet?.plain === true ? verbatim(items) : framed(items);

const CONTINUED: Delivery = { items: [], text: CONTINUE_WORDS, spoken: '', digest: undefined, typed: typedShape(CONTINUE_WORDS) };

const unwritten = (cause: Cause.Cause<HarnessFailure>): HarnessFailure | null => {
  if (Cause.hasDies(cause) || Cause.hasInterrupts(cause)) return null;
  const failure = Cause.findErrorOption(cause);
  return Option.isSome(failure) ? failure.value : null;
};

const DRAFT_BEAT = Duration.millis(250);

const runStopped = (): GateRefusal =>
  new GateRefusal('run-stopped', 'The run was stopped before its words were printed.', ['send the words again']);

export class TerminalRuns {
  constructor(
    private readonly store: HarnessSessionStore,
    private readonly driver: SessionDriver,
    private readonly words: TerminalWords,
    private readonly endings: TerminalEndings,
    private readonly interrupts: TerminalInterrupts,
    private readonly open: OpenRuns,
    private readonly watch: TerminalWatch,
    private readonly ownership: RunOwnership,
    private readonly inbox: ThreadInbox['Service'],
    private readonly journal: TerminalJournal,
    private readonly steering: FiberMap.FiberMap<string, void, never>,
    private readonly drafts: ComposerDrafts,
    private readonly adapters: HarnessAdapters['Service'],
  ) {}

  readonly transport: TransportRuns = {
    launch: (launch) => this.launch(launch),
    deliver: (run, items) => this.deliver(run, items),
    withdraw: () => Effect.succeed('unsent' satisfies Withdrawal),
    queued: (run) => this.watch.waiting(run.threadId),
    holds: (runIds) => this.open.holds(runIds),
    interrupt: (runId, by) => this.interrupt(runId, by),
    adopt: (candidate) => bordered(this.adopt(candidate)),
    reached: () => Effect.void,
    wordsWait: (threadId) => (this.drafts.held(threadId) ? 'composer-draft' : null),
  };

  current(threadId: string): Effect.Effect<ThreadRunRef | null, HarnessFailure> {
    return Effect.map(this.store.read(threadId), (facet) => (facet?.turn === undefined ? null : { id: facet.turn.run, threadId }));
  }

  private launch(launch: RunLaunch): Effect.Effect<void, LaunchFailed> {
    const threadId = launch.thread.id;
    const runId = launch.run.id;
    return Effect.suspend(() => {
      if (this.open.has(runId)) return Effect.void;
      this.open.add(runId, threadId);
      return this.open.launching(runId, this.declare(threadId, runId, launch.seed));
    });
  }

  private readonly launched = Effect.fnUntraced(function* (
    this: TerminalRuns,
    threadId: string,
    seed: readonly ThreadInboxItem[],
  ): Effect.fn.Return<Delivery, HarnessFailure> {
    const facet = yield* this.store.read(threadId);
    if (facet?.plain !== true) return deliveryOf(facet, seed);
    const asked = seed.filter(carriesWords);
    const stored = yield* this.receipts(asked.map((item) => item.id));
    if (stored.length !== asked.length) {
      return yield* new GateRefusal('input-missing', 'An item handed to this run is not in the inbox, so its words are unknown.', [
        'send the words again',
      ]);
    }
    return deliveryOf(facet, stored);
  });

  private readonly declare = Effect.fnUntraced(function* (
    this: TerminalRuns,
    threadId: string,
    runId: string,
    seed: readonly ThreadInboxItem[],
  ): Effect.fn.Return<void, LaunchFailed> {
    const facet = yield* this.store.read(threadId).pipe(Effect.mapError((failure) => new LaunchFailed({ reason: reasonOf(failure) })));
    if (facet !== null)
      yield* this.journal
        .open(
          { id: runId, threadId },
          facet,
          seed.map((item) => item.id),
        )
        .pipe(Effect.mapError((failure) => new LaunchFailed({ reason: reasonOf(failure) })));
    const read = yield* Effect.result(this.launched(threadId, seed));
    if (read._tag === 'Failure') return yield* this.refused(threadId, runId, read.failure);
    const delivery = read.success.text === '' ? CONTINUED : read.success;
    const aligned = yield* Effect.result(this.driver.aligned(threadId));
    if (aligned._tag === 'Failure') return yield* this.refused(threadId, runId, aligned.failure);
    const declared = yield* Effect.result(this.words.intend(threadId, runId, delivery.items, delivery.spoken, delivery.digest));
    if (declared._tag === 'Failure') return yield* this.refused(threadId, runId, declared.failure);
    const refusal = yield* this.print(threadId, runId, delivery);
    if (refusal !== null) return yield* this.refused(threadId, runId, refusal);
    if (delivery.items.length > 0) yield* this.watch.awaiting(threadId);
    yield* this.watch.waiting(threadId);
  });

  private stopped(runId: string): boolean {
    return this.open.halted(runId) || !this.open.has(runId);
  }

  private readonly halted = Effect.fnUntraced(function* (this: TerminalRuns, threadId: string, runId: string) {
    if (!this.open.halted(runId)) return false;
    const ended = yield* Effect.result(this.endings.stopped(threadId, runId, false));
    if (ended._tag === 'Failure') {
      yield* Effect.logWarning('a run stopped before its CLI took its words could not be ended', {
        threadId,
        runId,
        cause: ended.failure,
      });
      return false;
    }
    return true;
  });

  private readonly refused = Effect.fnUntraced(function* (
    this: TerminalRuns,
    threadId: string,
    runId: string,
    failure: unknown,
  ): Effect.fn.Return<void, LaunchFailed> {
    if (yield* this.halted(threadId, runId)) return;
    const retracted = yield* Effect.result(this.words.retract(threadId, runId));
    if (retracted._tag === 'Failure') {
      yield* Effect.logWarning('the declared words of a refused launch could not be withdrawn from the thread row', {
        threadId,
        runId,
        cause: retracted.failure,
      });
    }
    this.open.drop(runId);
    return yield* Effect.fail(new LaunchFailed({ reason: reasonOf(failure) }));
  });

  private readonly print = Effect.fnUntraced(function* (
    this: TerminalRuns,
    threadId: string,
    runId: string,
    delivery: Delivery,
    launches = true,
  ): Effect.fn.Return<HarnessFailure | null> {
    if (this.stopped(runId)) return runStopped();
    const waited = yield* Effect.result(
      Effect.raceFirst(
        Effect.as(Effect.andThen(this.interrupts.settled(threadId), this.driver.ready(threadId)), false),
        Effect.as(this.open.halting(runId), true),
      ),
    );
    if (waited._tag === 'Failure') return waited.failure;
    if (waited.success || this.stopped(runId)) return runStopped();
    const seat = yield* Effect.result(this.driver.seat(threadId));
    if (seat._tag === 'Failure') return seat.failure;
    const standing = seat.success;
    if (standing._tag === 'Refused') return new GateRefusal('cli-standing', standing.reason, ['send again once the CLI is at its prompt']);
    if (standing._tag === 'Typable' && delivery.text === '') return null;
    if (standing._tag === 'None' && !launches) {
      return new GateRefusal('cli-gone', 'The CLI of this turn ended before these words were typed.', ['send the words again']);
    }
    yield* this.watch.mark(threadId);
    if (standing._tag === 'Typable') return yield* this.drafting(threadId, runId, standing.execution, delivery);
    if (delivery.text !== '') {
      const marked = yield* Effect.result(this.words.sending(threadId, runId, delivery.items, delivery.typed));
      if (marked._tag === 'Failure') return marked.failure;
      if (!marked.success) return null;
    }
    return yield* this.started(threadId, runId, delivery.text);
  });

  private readonly started = Effect.fnUntraced(function* (
    this: TerminalRuns,
    threadId: string,
    runId: string,
    text: string,
  ): Effect.fn.Return<HarnessFailure | null> {
    yield* this.journal.reports.live(
      { id: runId, threadId },
      { op: 'phase', phase: 'opening', waiting: { reason: WAITING_REASONS.process, place: null } },
    );
    const launched = yield* Effect.exit(this.driver.launch(threadId, runId, text));
    if (Exit.isSuccess(launched)) return null;
    const refusal = unwritten(launched.cause);
    if (refusal !== null) {
      const read = yield* Effect.result(this.store.read(threadId));
      if (read._tag === 'Success' && !harnessSessionActive(read.success?.session)) return refusal;
      if (read._tag === 'Failure') {
        yield* Effect.logWarning('the CLI session could not be read after its launch failed; whether it took the words remains unknown', {
          threadId,
          failure: String(read.failure),
        });
      }
    }
    yield* Effect.logWarning('a CLI session was opened with printed words but its start did not finish; the words are not printed again', {
      threadId,
      cause: Cause.pretty(launched.cause),
    });
    return null;
  });

  private drafting(
    threadId: string,
    runId: string,
    execution: HarnessExecutionRef,
    delivery: Delivery,
  ): Effect.Effect<HarnessFailure | null> {
    const holding = { held: false };
    return this.cleared(threadId, runId, execution, delivery, holding).pipe(
      Effect.ensuring(Effect.suspend(() => (holding.held ? this.drafts.release(threadId) : Effect.void))),
    );
  }

  private readonly cleared = Effect.fnUntraced(function* (
    this: TerminalRuns,
    threadId: string,
    runId: string,
    execution: HarnessExecutionRef,
    delivery: Delivery,
    holding: { held: boolean },
  ): Effect.fn.Return<HarnessFailure | null> {
    for (;;) {
      const typed = yield* this.typed(threadId, runId, execution, delivery);
      if (typed !== 'drafted') return typed;
      if (!holding.held) {
        holding.held = true;
        yield* this.drafts.hold(threadId);
      }
      const halted = yield* Effect.raceFirst(Effect.as(Effect.sleep(DRAFT_BEAT), false), Effect.as(this.open.halting(runId), true));
      if (halted || this.stopped(runId)) return runStopped();
    }
  });

  private typed(
    threadId: string,
    runId: string,
    execution: HarnessExecutionRef,
    delivery: Delivery,
  ): Effect.Effect<HarnessFailure | null | 'drafted'> {
    const { driver, words } = this;
    const stopped = (id: string) => this.stopped(id);
    const act = (keyboard: Keyboard) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          if (stopped(runId)) return yield* runStopped();
          if (yield* restore(keyboard.asking)) return null;
          if ((yield* restore(keyboard.composer)) !== null) return 'drafted' as const;
          if (stopped(runId)) return yield* runStopped();
          if (!(yield* words.sending(threadId, runId, delivery.items, delivery.typed))) return null;
          const typed = yield* Effect.exit(restore(keyboard.words(delivery.text)));
          if (Exit.isFailure(typed) && unwritten(typed.cause) !== null) return yield* Effect.failCause(typed.cause);
          const uncertain = Exit.isSuccess(typed)
            ? (typed.value.failure ?? null)
            : unproven('the typing was cut short, so whether the CLI took these words is unknown');
          const recorded = yield* Effect.result(words.accepted(threadId, uncertain, delivery.items));
          if (recorded._tag === 'Failure') {
            yield* Effect.logWarning(
              'printed words were typed but their receipt could not be recorded; they stay unread and are never printed again',
              { threadId, cause: recorded.failure },
            );
          }
          return null;
        }),
      );
    return Effect.flatMap(
      Effect.exit(driver.typing(threadId, execution, act)),
      (exit): Effect.Effect<HarnessFailure | null | 'drafted'> => {
        if (Exit.isSuccess(exit)) return Effect.succeed(exit.value);
        const refusal = unwritten(exit.cause);
        if (refusal !== null) return Effect.succeed(refusal);
        return Cause.hasInterrupts(exit.cause) ? Effect.interrupt : Effect.die(Cause.squash(exit.cause));
      },
    );
  }

  private deliver(run: ThreadRunRow, items: readonly ThreadInboxItem[]): Effect.Effect<void> {
    return Effect.andThen(
      this.watch.waiting(run.threadId),
      Effect.asVoid(
        FiberMap.run(this.steering, `${run.id}:${items.map((item) => item.id).join(',')}`, this.steer(run, items), {
          onlyIfMissing: true,
        }),
      ),
    );
  }

  private steer(run: ThreadRunRow, items: readonly ThreadInboxItem[]): Effect.Effect<void> {
    return this.steered(run, items).pipe(
      Effect.catch((failure) =>
        Effect.logWarning('words given to a running turn could not be typed into its CLI; they wait for the turn to end', {
          threadId: run.threadId,
          runId: run.id,
          failure,
        }),
      ),
    );
  }

  private readonly steered = Effect.fnUntraced(function* (
    this: TerminalRuns,
    run: ThreadRunRow,
    items: readonly ThreadInboxItem[],
  ): Effect.fn.Return<void, HarnessFailure> {
    const threadId = run.threadId;
    yield* this.open.landing(run.id);
    if (this.stopped(run.id)) return;
    const facet = yield* this.store.read(threadId);
    if (facet === null || this.adapters.find(facet.name)?.steer !== 'step' || !harnessSessionActive(facet.session)) return;
    const delivery = yield* this.launched(threadId, items);
    if (delivery.items.length === 0) return;
    if (!(yield* this.words.steered(threadId, run.id, delivery.items, delivery.digest))) return;
    const refusal = yield* this.print(threadId, run.id, delivery, false);
    if (refusal !== null) return yield* refusal;
    yield* this.watch.awaiting(threadId);
  });

  private interrupt(runId: string, by: ThreadRunStoppedBy | null): Effect.Effect<InterruptReceipt, ThreadPortFailure> {
    return failedAs('terminal.interrupt', this.interrupted(runId, by));
  }

  private readonly interrupted = Effect.fnUntraced(function* (
    this: TerminalRuns,
    runId: string,
    by: ThreadRunStoppedBy | null,
  ): Effect.fn.Return<InterruptReceipt, HarnessFailure> {
    const threadId = this.open.threadOf(runId) ?? (yield* this.store.threadOfRun(runId));
    if (threadId === null) return 'no-turn';
    const held = this.open.has(runId);
    this.open.halt(runId, by);
    if (held) yield* this.open.landing(runId);
    const facet = yield* this.store.read(threadId);
    if (facet === null || facet.turn?.run !== runId) {
      if (!held) return facet === null ? 'no-turn' : yield* this.interrupts.repeated(threadId, runId, facet);
      if (this.open.has(runId)) yield* this.endings.stopped(threadId, runId, false);
      return 'interrupted';
    }
    yield* this.interrupts.press(threadId, runId, facet);
    return 'interrupted';
  });

  readonly adopt = Effect.fnUntraced(function* (
    this: TerminalRuns,
    candidate: ThreadAbandonedRun,
  ): Effect.fn.Return<HostedResume, HarnessFailure> {
    const facet = yield* this.store.read(candidate.threadId);
    if (facet === null || (facet.turn !== undefined && facet.turn.run !== candidate.id)) return 'declined' as const;
    const unopened = facet.turn === undefined ? yield* this.receipts(yield* this.delivered(candidate)) : [];
    if (facet.turn === undefined && unopened.length === 0) return 'declined' as const;
    const gone =
      facet.turn !== undefined &&
      !owedOf(facet, candidate.id).some((entry) => entry.send === 'intended') &&
      !(yield* this.standing(candidate.threadId, facet));
    const adoption = yield* failedAs('terminal.adopt', this.ownership.adopt(candidate));
    if (adoption !== 'adopted') return adoption;
    yield* failedAs('terminal.restoreActivity', this.journal.restore(candidate, facet));
    this.open.add(candidate.id, candidate.threadId);
    if (gone) {
      yield* this.ended(candidate).pipe(Effect.onError(() => Effect.sync(() => this.open.drop(candidate.id))));
      return 'adopted' as const;
    }
    const resumed = yield* this.resume(candidate, facet, unopened).pipe(
      Effect.onExit((exit) => (Exit.isFailure(exit) ? Effect.sync(() => this.open.drop(candidate.id)) : Effect.void)),
    );
    if (resumed === 'ended') return 'adopted' as const;
    yield* this.watch.check(candidate.threadId, { returned: true });
    yield* this.watch.awaiting(candidate.threadId);
    yield* this.watch.waiting(candidate.threadId);
    return 'adopted' as const;
  });

  private readonly ended = Effect.fnUntraced(function* (this: TerminalRuns, candidate: ThreadRunRef) {
    const { endings, store } = this;
    yield* this.driver.reconcile(candidate.threadId);
    yield* store.change(
      candidate.threadId,
      (facet, unit) =>
        Effect.gen(function* () {
          const session = facet.session;
          if (harnessSessionActive(session) || facet.turn?.run !== candidate.id) return { facet, value: undefined };
          const failure = session?.failure ?? null;
          const settled = yield* endings.ended(
            facet,
            unit,
            candidate.threadId,
            { outcome: failure === null ? 'aborted' : 'failed', failure, launching: false },
            null,
          );
          yield* unit.afterCommit(settled.after);
          return { facet: settled.facet, value: undefined };
        }),
      endings.writes,
    );
  });

  private standing(threadId: string, facet: ExternalSession): Effect.Effect<boolean, HarnessFailure> {
    return facet.session?.state === 'starting' ? Effect.succeed(true) : this.driver.alive(threadId);
  }

  private readonly resume = Effect.fnUntraced(function* (
    this: TerminalRuns,
    candidate: ThreadAbandonedRun,
    facet: ExternalSession,
    unopened: readonly ThreadInboxItem[],
  ): Effect.fn.Return<'standing' | 'ended', HarnessFailure> {
    const threadId = candidate.threadId;
    if (facet.turn === undefined) {
      const delivery = deliveryOf(facet, unopened);
      yield* this.words.intend(threadId, candidate.id, delivery.items, delivery.spoken, delivery.digest);
      return yield* this.printed(candidate, delivery);
    }
    const owed = owedOf(facet, candidate.id);
    for (const entry of owed) {
      if (entry.send !== 'sending') continue;
      yield* this.words.accepted(
        threadId,
        unproven('this server stopped before the print receipt was recorded, so whether the CLI took these words is unknown'),
        entry.items,
      );
    }
    return yield* this.reprinted(candidate, facet, owed);
  });

  private readonly reprinted = Effect.fnUntraced(function* (
    this: TerminalRuns,
    run: ThreadRunRef,
    facet: ExternalSession,
    owed: readonly HarnessUnread[],
  ): Effect.fn.Return<'standing' | 'ended', HarnessFailure> {
    for (const entry of owed) {
      if (entry.send !== 'intended') continue;
      if ((yield* this.printed(run, deliveryOf(facet, yield* this.receipts(entry.items)))) === 'ended') return 'ended' as const;
    }
    return 'standing' as const;
  });

  readonly released = Effect.fnUntraced(function* (this: TerminalRuns, threadId: string): Effect.fn.Return<void, HarnessFailure> {
    const facet = yield* this.store.read(threadId);
    const turn = facet?.turn;
    if (facet === null || turn === undefined || !this.open.has(turn.run)) return;
    const owed = owedOf(facet, turn.run);
    if (!owed.some((entry) => entry.send === 'intended')) return;
    if ((yield* this.reprinted({ threadId, id: turn.run }, facet, owed)) === 'standing') yield* this.watch.awaiting(threadId);
  });

  private readonly printed = Effect.fnUntraced(function* (
    this: TerminalRuns,
    candidate: ThreadRunRef,
    delivery: Delivery,
  ): Effect.fn.Return<'standing' | 'ended', HarnessFailure> {
    const { endings } = this;
    const refusal = yield* this.print(candidate.threadId, candidate.id, delivery);
    if (refusal === null) return 'standing' as const;
    if (yield* this.halted(candidate.threadId, candidate.id)) return 'ended' as const;
    yield* this.store.change(
      candidate.threadId,
      (facet, unit) =>
        Effect.gen(function* () {
          const settled = yield* endings.ended(
            facet,
            unit,
            candidate.threadId,
            { outcome: 'failed', failure: reasonOf(refusal), launching: true },
            null,
          );
          yield* unit.afterCommit(settled.after);
          return { facet: settled.facet, value: undefined };
        }),
      endings.writes,
    );
    return 'ended' as const;
  });

  private delivered(candidate: ThreadAbandonedRun): Effect.Effect<readonly string[], HarnessFailure> {
    return Effect.mapError(this.inbox.delivered(candidate.threadId, candidate.id), (cause): HarnessFailure => cause);
  }

  private readonly receipts = Effect.fnUntraced(function* (
    this: TerminalRuns,
    ids: readonly string[],
  ): Effect.fn.Return<readonly ThreadInboxItem[], HarnessFailure> {
    const found = yield* Effect.forEach(ids, (id) => Effect.mapError(this.inbox.receipt(id), (cause): HarnessFailure => cause));
    return found.filter((item): item is ThreadInboxItem => item !== undefined);
  });
}
