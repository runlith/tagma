import { Clock, Effect } from 'effect';
import type { RunOwnership } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { RunEnding } from '@runlith/agent/thread/run/lifecycle/RunReports';
import type { ThreadRunStoppedBy } from '@runlith/agent/thread/ending';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import { failedAs, type HarnessFailure } from '../../threads/contract/service/failure.js';
import type { HarnessProcessOutcome } from '../../threads/contract/wire/harness/session.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import { assistantWords, userWords } from './entries.js';
import type { TerminalJournal } from './journal.js';
import type { OpenRuns } from './open.js';
import { closedWords, returnedWords, stoppedWords, unsent } from './words.js';
import type { TerminalWatch } from './watch.js';
import type { TerminalClosing, TurnSpend } from './closing.js';

const UNHEARD = 'It ended before it read the words of this run, so they were not carried out and are not repeated.';

export type ProcessEnded = {
  readonly outcome: HarnessProcessOutcome;
  readonly failure: string | null;
  readonly launching: boolean;
};

export type Settled = { readonly facet: ExternalSession; readonly after: Effect.Effect<void> };

export type HeldAnswer = {
  readonly turn: string;
  readonly text: string;
  readonly unproven?: boolean | undefined;
};

export class TerminalEndings {
  constructor(
    private readonly store: HarnessSessionStore,
    private readonly journal: TerminalJournal,
    private readonly open: OpenRuns,
    private readonly watch: TerminalWatch,
    private readonly ownership: RunOwnership,
    private readonly closing: TerminalClosing,
  ) {}

  readonly resumed = Effect.fnUntraced(function* (this: TerminalEndings, threadId: string) {
    const taken = yield* failedAs('terminal.resumeParked', this.ownership.resumeParked(threadId));
    const { store, journal, open } = this;
    yield* Effect.gen(function* () {
      if (taken.runId === null) return;
      const facet = yield* store.read(threadId);
      if (facet !== null) yield* failedAs('terminal.restoreActivity', journal.restore({ id: taken.runId, threadId }, facet));
      open.add(taken.runId, threadId);
    }).pipe(Effect.ensuring(Effect.sync(() => taken.release())));
  });

  get writes() {
    return this.journal.writes;
  }

  readonly settle = Effect.fnUntraced(function* (this: TerminalEndings, threadId: string) {
    const checked = yield* Effect.result(this.watch.check(threadId, { settling: true }));
    if (checked._tag === 'Failure')
      yield* Effect.logWarning('the transcript evidence of a dying CLI could not be read; its unread words lapse', {
        threadId,
        cause: checked.failure,
      });
    return yield* this.spent(threadId);
  });

  private readonly spent = Effect.fnUntraced(function* (this: TerminalEndings, threadId: string) {
    const read = yield* Effect.result(this.store.read(threadId));
    if (read._tag === 'Success') return read.success === null ? null : yield* this.closing.spent(threadId, read.success);
    yield* Effect.logWarning('the session of an ended terminal turn could not be read; its run records no requests', {
      threadId,
      cause: read.failure,
    });
    return null;
  });

  readonly ended = Effect.fnUntraced(
    function* (
      this: TerminalEndings,
      facet: ExternalSession,
      unit: WriteUnit<'machine'>,
      threadId: string,
      details: ProcessEnded,
      spent: TurnSpend | null,
    ) {
      const turn = facet.turn;
      if (turn === undefined || !this.open.has(turn.run)) {
        const standing = facet.unread ?? [];
        if (standing.length === 0) return { facet, after: Effect.void } satisfies Settled;
        yield* this.journal.apply(unit, [
          ...returnedWords(this.journal, threadId, standing),
          ...standing
            .filter((entry) => !unsent(entry))
            .map((entry) => this.journal.reports.lapsed({ id: entry.run, threadId }, entry.items)),
        ]);
        const { unread: _lapsed, ...rest } = facet;
        return { facet: rest, after: Effect.void } satisfies Settled;
      }
      const stoppedBy = this.open.stoppedBy(turn.run);
      const unread = facet.unread ?? [];
      const unheard =
        details.outcome !== 'aborted' &&
        !details.launching &&
        !this.open.halted(turn.run) &&
        unread.some((entry) => entry.run === turn.run);
      const ending: RunEnding = unheard
        ? { kind: 'failed', reason: `${details.failure ?? 'The CLI process ended.'} ${UNHEARD}` }
        : details.outcome === 'failed'
          ? details.launching
            ? { kind: 'failed', reason: details.failure ?? 'The CLI could not be started.', launch: true }
            : { kind: 'failed', reason: details.failure ?? 'The CLI process ended.' }
          : { kind: 'aborted', stoppedBy };
      const run = { id: turn.run, threadId };
      const launchFailed = ending.kind === 'failed' && ending.launch === true;
      const owed = unread.filter((entry) => !((launchFailed || unheard) && entry.run === turn.run));
      const results = yield* this.journal.apply(unit, [
        ...(launchFailed ? [this.journal.reports.refused(run)] : []),
        ...(ending.kind === 'aborted' && turn.words !== undefined
          ? [this.journal.reports.recorded(run, [userWords(turn.run, turn.words)], `words:${turn.run}`)]
          : []),
        ...this.closing.close(run, ending, spent),
      ]);
      if (results.at(-1)?.status === 'unowned') return { facet, after: Effect.void } satisfies Settled;
      yield* this.journal.apply(unit, [
        ...returnedWords(this.journal, threadId, owed),
        ...owed.filter((entry) => !unsent(entry)).map((entry) => this.journal.reports.lapsed({ id: entry.run, threadId }, entry.items)),
      ]);
      const { turn: _gone, unread: _unread, ...rest } = facet;
      return {
        facet: rest,
        after: Effect.andThen(
          Effect.sync(() => this.open.drop(turn.run)),
          this.watch.quieted(threadId),
        ),
      } satisfies Settled;
    },
    Effect.mapError((cause): HarnessFailure => cause as unknown as HarnessFailure),
  );

  stopped(threadId: string, runId: string, marked: boolean): Effect.Effect<'ended' | 'unowned', HarnessFailure> {
    const { journal, open, watch } = this;
    return this.store.change(
      threadId,
      (facet, unit) =>
        Effect.gen(function* () {
          const turn = facet.turn?.run === runId ? facet.turn : undefined;
          const run = { id: runId, threadId };
          const handed = (facet.unread ?? []).filter((entry) => entry.run === runId);
          const results = yield* journal.apply(unit, [
            ...(turn?.words === undefined ? [] : [journal.reports.recorded(run, [userWords(runId, turn.words)], `words:${runId}`)]),
            ...stoppedWords(journal, threadId, handed, turn?.words !== undefined),
            journal.reports.ended(run, { kind: 'aborted', stoppedBy: open.stoppedBy(runId) }),
          ]);
          if (results.at(-1)?.status === 'unowned') return { facet, value: 'unowned' as const };
          yield* unit.afterCommit(Effect.sync(() => open.end(runId)));
          if (turn === undefined) return { facet, value: 'ended' as const };
          yield* unit.afterCommit(watch.quieted(threadId));
          const { turn: _stopped, unread, ...rest } = facet;
          const kept = (unread ?? []).filter((entry) => entry.run !== runId);
          const at = new Date(yield* Clock.currentTimeMillis).toISOString();
          const next = marked ? { ...rest, interrupted: { turn, at } } : rest;
          return { facet: kept.length === 0 ? next : { ...next, unread: kept }, value: 'ended' as const };
        }).pipe(Effect.mapError((cause): HarnessFailure => cause as unknown as HarnessFailure)),
      journal.writes,
    );
  }

  readonly held = Effect.fnUntraced(function* (this: TerminalEndings, threadId: string, answer: HeldAnswer) {
    const { journal, open, closing } = this;
    const spent = yield* this.spent(threadId);
    return yield* this.store.change(
      threadId,
      (facet, unit) =>
        Effect.gen(function* () {
          const turn = facet.turn;
          if (turn === undefined) return { facet, value: undefined };
          const text =
            answer.unproven === true ? `${answer.text}\n\n(unproven: the export that names this session was never read)` : answer.text;
          const run = { id: turn.run, threadId };
          const now = yield* Clock.currentTimeMillis;
          const results = yield* journal.apply(unit, [
            journal.reports.recorded(
              run,
              [assistantWords(turn.run, turn.spoke ?? 0, text, new Date(now).toISOString())],
              `held:${answer.turn}`,
            ),
            ...closing.close(run, { kind: 'completed' }, spent),
          ]);
          if (results.at(-1)?.status === 'unowned') return { facet, value: undefined };
          const { turn: _gone, ...rest } = facet;
          const closed = closedWords(journal, threadId, rest, turn.run);
          yield* journal.apply(unit, closed.plans);
          yield* unit.afterCommit(Effect.sync(() => open.drop(turn.run)));
          return { facet: closed.facet, value: undefined };
        }).pipe(Effect.mapError((cause): HarnessFailure => cause as unknown as HarnessFailure)),
      journal.writes,
    );
  });
}
