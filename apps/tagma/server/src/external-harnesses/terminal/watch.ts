import { Clock, Duration, Effect, FiberMap, Option } from 'effect';
import { carriesWords } from '@runlith/agent/thread/inboxItems';
import type { ReportPlan, RunEnding } from '@runlith/agent/thread/run/lifecycle/RunReports';
import type { Environments } from '../../workspace/contract/service/environments.js';
import { failedAs, type HarnessFailure } from '../../threads/contract/service/failure.js';
import type { ExternalSession, HarnessTurn } from '../../threads/contract/wire/harness/externalSession.js';
import { harnessSessionActive } from '../../threads/contract/wire/harness/session.js';
import { screenLines } from '@runlith/executions/protocol/presentationText';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import type { TerminalScreens } from '../../executions/contract/service/records.js';
import { readHarnessFrame } from '../sessions/keyboard.js';
import type { HarnessAdapter, HarnessAddress } from '../contract/service/adapter.js';
import { harnessAdapter } from '../contract/service/table.js';
import { readBefore, readTail } from '../ends/read.js';
import { writes, type WriteSet } from '../../platform/contract/service/writes.js';
import type { SessionAlignment } from '../sessions/alignment.js';
import type { TailEnd, TailSource } from '../ends/tail.js';
import type { MetadataInput } from '../metadata/sources.js';
import { endsSource } from '../ends/table.js';
import { inputOf } from '../metadata/harnessMetadata.js';
import { readHarnessTranscript, sessionFiles, type HarnessReading } from '../metadata/words.js';
import type { TerminalClosing } from './closing.js';
import type { ThreadInbox } from '../../threads/store/inbox.js';
import type { SessionThreads } from '../contract/service/sessionThreads.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { StandingSession } from '../contract/service/sessionRows.js';
import {
  COMPACTION_BEAT_MS,
  PLAIN_BEAT_MS,
  PROMPT_BEAT_MS,
  QUIET_WINDOW_MS,
  READ_DEADLINE_MS,
  decideWatch,
  promptStep,
  untaken,
  type PromptIdle,
  type PromptSample,
} from './decide.js';
import { assistantWords } from './entries.js';
import type { TerminalJournal } from './journal.js';
import type { OpenRuns } from './open.js';
import { closedWords } from './words.js';
import { armedConfirmed } from './interrupts.js';

const finishedBy = (end: TailEnd): RunEnding | null => {
  switch (end._tag) {
    case 'Completed':
      return { kind: 'completed' };
    case 'Aborted':
      return { kind: 'aborted', stoppedBy: 'reader' };
    case 'Failed':
      return { kind: 'failed', reason: end.reason, cause: end.cause };
    case 'Open':
      return null;
  }
};

export type CheckOptions = { readonly returned?: boolean; readonly settling?: boolean; readonly idle?: PromptIdle };

const RETURNED: CheckOptions = { returned: true };

type Silence = { readonly window: number; readonly proof: 'screen' | 'tail' };

export type ProvenEnd = { readonly run: string; readonly ending: RunEnding; readonly message: string | null };

export type RunAsking = (threadId: string, run: string) => Effect.Effect<boolean, HarnessFailure>;

export class TerminalWatch {
  constructor(
    private readonly store: HarnessSessionStore,
    private readonly journal: TerminalJournal,
    private readonly open: OpenRuns,
    private readonly inbox: ThreadInbox['Service'],
    private readonly access: Environments['Service'],
    private readonly threads: SessionThreads,
    private readonly terminals: Terminals['Service'],
    private readonly screens: TerminalScreens['Service'],
    private readonly asking: RunAsking,
    private readonly timers: FiberMap.FiberMap<string>,
    private readonly closing: TerminalClosing,
    private readonly alignment: SessionAlignment,
  ) {
    this.placing = writes('TerminalWatch.baseline', [], journal.writes, alignment.writes);
  }

  private readonly placing: WriteSet;

  readonly rearm = Effect.fnUntraced(function* (this: TerminalWatch, standing: readonly StandingSession[]) {
    for (const { threadId, facet } of standing) {
      if (facet.turn !== undefined) yield* this.waiting(threadId);
      if ((facet.unread ?? []).length > 0) yield* this.awaiting(threadId);
    }
  });

  waiting(threadId: string): Effect.Effect<void> {
    return Effect.asVoid(FiberMap.run(this.timers, `wait:${threadId}`, this.quiet(threadId)));
  }

  silenceWatched(adapter: HarnessAdapter): boolean {
    return this.proofOf(adapter) !== null;
  }

  private proofOf(adapter: HarnessAdapter): Silence['proof'] | null {
    if (endsSource(adapter) === null) return null;
    if (adapter.ends.tail === 'final') return 'tail';
    return adapter.ends.idle === null && adapter.promptScreenOf !== undefined ? 'screen' : null;
  }

  private silence(facet: ExternalSession): Silence | null {
    if (facet.plain === true) return { window: PLAIN_BEAT_MS, proof: 'tail' };
    const proof = this.proofOf(harnessAdapter(facet.name));
    return proof === null ? null : { window: QUIET_WINDOW_MS, proof };
  }

  private promptShown(threadId: string, adapter: HarnessAdapter): Effect.Effect<PromptIdle | null> {
    const { store, terminals, screens } = this;
    const recognize = adapter.promptScreenOf;
    return Effect.gen(function* () {
      if (recognize === undefined) return null;
      const seen: PromptSample[] = [];
      for (;;) {
        if (seen.length > 0) yield* Effect.sleep(Duration.millis(PROMPT_BEAT_MS));
        const facet = yield* store.read(threadId);
        const execution = facet?.execution;
        if (facet === null || facet.turn === undefined || execution == null) return null;
        const frame = yield* readHarnessFrame(terminals, screens, execution);
        const sample = { shown: recognize(screenLines(frame)), movedAt: facet.turn.movedAt };
        const step = promptStep(seen, sample);
        if (step === 'confirmed') return { movedAt: sample.movedAt };
        if (step === 'broken') return null;
        seen.push(sample);
      }
    }).pipe(
      Effect.result,
      Effect.flatMap((done) =>
        done._tag === 'Failure'
          ? Effect.as(
              Effect.logWarning('the screen of a terminal CLI could not be read for its prompt', { threadId, cause: done.failure }),
              null,
            )
          : Effect.succeed(done.success),
      ),
    );
  }

  quieted(threadId: string): Effect.Effect<void> {
    return Effect.asVoid(FiberMap.remove(this.timers, `wait:${threadId}`));
  }

  awaiting(threadId: string): Effect.Effect<void> {
    return Effect.asVoid(FiberMap.run(this.timers, `read:${threadId}`, this.deadline(threadId)));
  }

  promptReturned(threadId: string): Effect.Effect<void> {
    return this.settled(threadId, this.check(threadId, { returned: true }));
  }

  private settled(threadId: string, work: Effect.Effect<void, HarnessFailure>): Effect.Effect<void> {
    return Effect.flatMap(Effect.result(work), (done) =>
      done._tag === 'Failure' ? Effect.logWarning('a terminal run could not be checked', { threadId, cause: done.failure }) : Effect.void,
    );
  }

  private wordWaits(threadId: string): Effect.Effect<boolean, HarnessFailure> {
    return Effect.map(
      Effect.mapError(this.inbox.pending(threadId), (cause): HarnessFailure => cause),
      (items) => items.some((item) => item.state === 'queued' && carriesWords(item)),
    );
  }

  private readonly retrying = Effect.fnUntraced(function* (threadId: string, timer: string, pass: Effect.Effect<boolean, HarnessFailure>) {
    for (;;) {
      const done = yield* Effect.result(pass);
      if (done._tag === 'Success') {
        if (done.success) return;
        continue;
      }
      yield* Effect.logWarning(`a terminal ${timer} timer could not read its state; it tries again`, { threadId, cause: done.failure });
      yield* Effect.sleep(Duration.millis(QUIET_WINDOW_MS));
    }
  });

  private quiet(threadId: string): Effect.Effect<void> {
    const marks = { checked: 0 };
    return this.retrying(threadId, 'quiet', this.quietPass(threadId, marks));
  }

  private readonly quietPass = Effect.fnUntraced(function* (this: TerminalWatch, threadId: string, marks: { checked: number }) {
    const facet = yield* this.store.read(threadId);
    const turn = facet?.turn;
    if (facet === null || turn === undefined || !harnessSessionActive(facet.session)) return true;
    const waiting = yield* this.wordWaits(threadId);
    const silence = this.silence(facet);
    if (!waiting && silence === null) return true;
    const moved = Math.max(Date.parse(turn.movedAt ?? turn.openedAt), marks.checked);
    const due = moved + (silence?.window ?? QUIET_WINDOW_MS);
    const now = yield* Clock.currentTimeMillis;
    if (now < due) {
      yield* Effect.sleep(Duration.millis(due - now));
      return false;
    }
    const asked = waiting ? RETURNED : yield* this.proven(threadId, facet, silence);
    if (asked !== null) yield* this.settled(threadId, this.check(threadId, asked));
    marks.checked = yield* Clock.currentTimeMillis;
    return false;
  });

  private readonly proven = Effect.fnUntraced(function* (
    this: TerminalWatch,
    threadId: string,
    facet: ExternalSession,
    silence: Silence | null,
  ): Effect.fn.Return<CheckOptions | null, HarnessFailure> {
    if (silence === null) return null;
    const adapter = harnessAdapter(facet.name);
    if (silence.proof === 'screen') return (yield* this.promptShown(threadId, adapter)) === null ? null : RETURNED;
    if ((facet.unread ?? []).length > 0 || untaken(facet, yield* Clock.currentTimeMillis)) return RETURNED;
    if ((yield* this.evidence(threadId)) !== null) return RETURNED;
    const { ends } = adapter;
    if (ends.tail !== 'final' || ends.interrupt !== 'screen' || facet.turn === undefined) return null;
    if (yield* this.asking(threadId, facet.turn.run)) return null;
    const idle = yield* this.promptShown(threadId, adapter);
    return idle === null ? null : { returned: true, idle };
  });

  private deadline(threadId: string): Effect.Effect<void> {
    const marks = { retryAt: 0 };
    return this.retrying(threadId, 'read-deadline', this.deadlinePass(threadId, marks));
  }

  private readonly deadlinePass = Effect.fnUntraced(function* (this: TerminalWatch, threadId: string, marks: { retryAt: number }) {
    const facet = yield* this.store.read(threadId);
    if (facet === null || !harnessSessionActive(facet.session)) return true;
    const sent = (facet.unread ?? []).filter((entry) => entry.send !== 'intended');
    if (sent.length === 0) return true;
    const due = Math.max(Math.min(...sent.map((entry) => Date.parse(entry.at))) + READ_DEADLINE_MS, marks.retryAt);
    const now = yield* Clock.currentTimeMillis;
    if (now < due) {
      yield* Effect.sleep(Duration.millis(due - now));
      return false;
    }
    yield* this.settled(threadId, this.check(threadId));
    marks.retryAt = (yield* Clock.currentTimeMillis) + QUIET_WINDOW_MS;
    return false;
  });

  private tail(input: MetadataInput, source: TailSource, turn: HarnessTurn) {
    return Effect.result(
      Effect.scoped(
        Effect.flatMap(sessionFiles(this.access, input, { kind: 'terminal-watch', id: input.execution.execution }), (files) =>
          readTail(files, source, input, { since: Date.parse(turn.openedAt), offset: turn.offset, turn: turn.turn || null }),
        ),
      ),
    );
  }

  readonly evidence = Effect.fnUntraced(function* (this: TerminalWatch, threadId: string): Effect.fn.Return<ProvenEnd | null> {
    const standing = yield* Effect.matchEffect(this.store.read(threadId), {
      onFailure: (cause) =>
        Effect.as(Effect.logWarning('terminal end evidence is unavailable: the session could not be read', { threadId, cause }), null),
      onSuccess: (standing) => Effect.succeed(standing),
    });
    if (standing === null || standing.turn === undefined) return null;
    return yield* this.endOf(threadId, standing, standing.turn);
  });

  readonly endOf = Effect.fnUntraced(function* (
    this: TerminalWatch,
    threadId: string,
    standing: ExternalSession,
    turn: HarnessTurn,
  ): Effect.fn.Return<ProvenEnd | null> {
    const input = inputOf(standing);
    const source = endsSource(harnessAdapter(standing.name));
    if (input === null || source === null) return null;
    const tail = yield* this.tail(input, source, turn);
    if (tail._tag === 'Failure') {
      yield* Effect.logWarning('terminal end evidence is unavailable: the transcript could not be read', { threadId, cause: tail.failure });
      return null;
    }
    if (tail.success._tag !== 'Read') return null;
    const ending = finishedBy(tail.success.end);
    if (ending === null) return null;
    return { run: turn.run, ending, message: tail.success.end._tag === 'Completed' ? tail.success.end.message : null };
  });

  readonly mark = Effect.fnUntraced(function* (this: TerminalWatch, threadId: string): Effect.fn.Return<void> {
    const standing = yield* Effect.matchEffect(this.store.read(threadId), {
      onFailure: (cause) =>
        Effect.as(Effect.logWarning('the transcript offset could not be taken: the session could not be read', { threadId, cause }), null),
      onSuccess: (standing) => Effect.succeed(standing),
    });
    if (standing === null) return;
    const { turn } = standing;
    const input = inputOf(standing);
    const source = endsSource(harnessAdapter(standing.name));
    if (turn === undefined || turn.offset !== null || input === null || source === null) return;
    const placed = yield* Effect.result(this.baseline(threadId, turn.run, source, input, harnessAdapter(standing.name).launch?.address));
    if (placed._tag === 'Failure')
      yield* Effect.logWarning('the transcript offset of a run could not be taken', { threadId, cause: placed.failure });
  });

  private readonly transcriptSize = Effect.fnUntraced(function* (
    this: TerminalWatch,
    input: MetadataInput,
    source: TailSource,
  ): Effect.fn.Return<number | null, HarnessFailure> {
    const where = source.locate(input);
    if (where === null) return null;
    return yield* failedAs(
      'terminal.size',
      Effect.scoped(
        Effect.flatMap(sessionFiles(this.access, input, { kind: 'terminal-watch', id: input.execution.execution }), (files) =>
          files.stat(where.path).pipe(
            Effect.map((info) => Number(info.size)),
            Effect.catchTag('PlatformError', (failure) =>
              failure.reason._tag === 'NotFound' ? Effect.succeed(null) : Effect.fail(failure),
            ),
          ),
        ),
      ),
    );
  });

  compacted(threadId: string): Effect.Effect<void> {
    return Effect.matchEffect(this.placeCompaction(threadId), {
      onFailure: (cause) => Effect.logWarning('the transcript of a compacting terminal CLI could not be placed', { threadId, cause }),
      onSuccess: () => Effect.void,
    });
  }

  private readonly placeCompaction = Effect.fnUntraced(function* (this: TerminalWatch, threadId: string) {
    const standing = yield* this.store.read(threadId);
    const input = standing === null ? null : inputOf(standing);
    const source = standing === null ? null : endsSource(harnessAdapter(standing.name));
    if (standing === null || input === null || source === null) return;
    const from = yield* this.transcriptSize(input, source);
    if (from === null) return;
    const read = Effect.matchEffect(this.compaction(threadId, from, standing.turn?.run ?? null), {
      onFailure: (cause) => Effect.logWarning('the context a terminal CLI kept after compaction could not be read', { threadId, cause }),
      onSuccess: () => Effect.void,
    });
    yield* FiberMap.run(this.timers, `compact:${threadId}`, read);
  });

  private readonly compaction = Effect.fnUntraced(function* (this: TerminalWatch, threadId: string, from: number, run: string | null) {
    const { store, access, journal } = this;
    const look = Effect.gen(function* () {
      const facet = yield* store.read(threadId);
      const input = facet === null ? null : inputOf(facet);
      if (facet === null || input === null || !harnessSessionActive(facet.session) || (facet.turn?.run ?? null) !== run)
        return { moved: true, compacted: null };
      const read = yield* readHarnessTranscript(access, input, harnessAdapter(facet.name), from);
      return { moved: false, compacted: read.compacted };
    });
    const seen = yield* Effect.delay(look, Duration.millis(COMPACTION_BEAT_MS)).pipe(
      Effect.repeat({ until: (state) => state.moved || state.compacted !== null }),
      Effect.timeoutOption(Duration.millis(QUIET_WINDOW_MS)),
    );
    const compacted = Option.isSome(seen) && !seen.value.moved ? seen.value.compacted : null;
    if (compacted === null || compacted.tokens === null) return;
    const tokens = compacted.tokens;
    const measuredAt = new Date(compacted.at ?? (yield* Clock.currentTimeMillis)).toISOString();
    yield* store.change(
      threadId,
      (standing, unit) =>
        Effect.as(
          journal.apply(unit, [journal.reports.outside(threadId, [], `compacted:${from}`, { kind: 'compacted', tokens, measuredAt })]),
          { facet: standing, value: undefined },
        ),
      journal.writes,
    );
  });

  private readonly baseline = Effect.fnUntraced(function* (
    this: TerminalWatch,
    threadId: string,
    run: string,
    source: TailSource,
    input: MetadataInput,
    address: HarnessAddress | undefined,
  ): Effect.fn.Return<boolean, HarnessFailure> {
    const { alignment } = this;
    const size = yield* this.transcriptSize(input, source);
    if (size === null) return false;
    const window = address?.reads !== 'transcript' ? null : yield* this.windowBefore(input, source, size);
    yield* this.store.change(
      threadId,
      (standing, unit) => {
        const turn = standing.turn;
        if (turn?.run !== run || turn.offset !== null) return Effect.succeed({ facet: standing, value: false });
        const vendor = turn.turn === null || turn.turn === '' ? null : turn.turn;
        const at = address === undefined || window === null ? undefined : address.of({ turn: vendor, before: window });
        const placed: ExternalSession = {
          ...standing,
          turn: at === undefined ? { ...turn, offset: size } : { ...turn, offset: size, address: at },
          unread: standing.unread?.map((entry) => (entry.run === run && entry.offset === undefined ? { ...entry, offset: size } : entry)),
        };
        const recorded = at === undefined || turn.turn === null ? Effect.void : alignment.taken(unit, threadId, run, at);
        return Effect.as(recorded, { facet: placed, value: true });
      },
      this.placing,
    );
    return true;
  });

  private readonly windowBefore = Effect.fnUntraced(function* (
    this: TerminalWatch,
    input: MetadataInput,
    source: TailSource,
    until: number,
  ) {
    const read = yield* Effect.result(
      Effect.scoped(
        Effect.flatMap(sessionFiles(this.access, input, { kind: 'terminal-watch', id: input.execution.execution }), (files) =>
          readBefore(files, source, input, until),
        ),
      ),
    );
    if (read._tag === 'Success') return read.success;
    yield* Effect.logWarning('the transcript before a run could not be read; the run keeps no vendor address', { cause: read.failure });
    return null;
  });

  readonly check = Effect.fnUntraced(function* (
    this: TerminalWatch,
    threadId: string,
    options: CheckOptions = {},
  ): Effect.fn.Return<void, HarnessFailure> {
    const { access, journal, open, threads, closing } = this;
    const facet = yield* this.store.read(threadId);
    if (facet === null) return;
    const unread = facet.unread ?? [];
    if (facet.turn === undefined && unread.length === 0) return;
    const input = inputOf(facet);
    const waiting = facet.turn !== undefined && (yield* this.wordWaits(threadId));
    const adapter = harnessAdapter(facet.name);
    const source = endsSource(adapter);
    const turn = facet.turn;
    const tail =
      turn === undefined || source === null || input === null || (!waiting && unread.length === 0 && options.returned !== true)
        ? null
        : yield* this.tail(input, source, turn);
    const from = unread.length === 0 ? 0 : Math.min(...unread.map((entry) => entry.offset ?? 0));
    const read = unread.length === 0 || input === null ? null : yield* Effect.result(readHarnessTranscript(access, input, adapter, from));
    const inTurn =
      read === null || read._tag !== 'Success' || turn === undefined || turn.offset === null || turn.offset <= from || input === null
        ? null
        : yield* Effect.result(readHarnessTranscript(access, input, adapter, turn.offset));
    const heardIn = (reading: HarnessReading | null): ReadonlySet<string> => {
      if (reading === null) return new Set();
      const typed = (entry: (typeof unread)[number]) =>
        reading.prompts.some((prompt) => prompt.digest === entry.digest && (prompt.at === null || prompt.at >= Date.parse(entry.at)));
      const plain = unread.flatMap((entry) => (entry.digest !== undefined && typed(entry) ? entry.items : []));
      return new Set([...reading.inputs, ...plain]);
    };
    const seen = heardIn(read !== null && read._tag === 'Success' ? read.success : null);
    const wholeInTurn = turn !== undefined && turn.offset !== null && turn.offset <= from;
    const seenInTurn = wholeInTurn ? seen : heardIn(inTurn !== null && inTurn._tag === 'Success' ? inTurn.success : null);
    if (read !== null && (read._tag === 'Failure' || !read.success.complete)) {
      yield* Effect.logWarning('the transcript of a terminal CLI was not read to its end; unread words may lapse unproven', { threadId });
    }
    const end = tail !== null && tail._tag === 'Success' && tail.success._tag === 'Read' ? tail.success.end : null;
    const now = yield* Clock.currentTimeMillis;
    const absent = tail !== null && tail._tag === 'Success' && tail.success._tag === 'Absent';
    const ending = end === null ? null : finishedBy(end);
    const message = end !== null && end._tag === 'Completed' ? end.message : null;
    const spending =
      ending === null || turn === undefined || input === null
        ? null
        : inTurn !== null && inTurn._tag === 'Success'
          ? inTurn
          : read !== null && read._tag === 'Success' && (turn.offset ?? 0) === from
            ? read
            : yield* Effect.result(readHarnessTranscript(access, input, adapter, turn.offset ?? 0));
    const whole = spending !== null && spending._tag === 'Success' && spending.success.complete ? spending.success : null;
    if (spending !== null && whole === null) {
      yield* Effect.logWarning('the transcript of an ended terminal turn was not read whole; its run records no requests', { threadId });
    }
    const spent = whole === null ? null : yield* closing.measure(facet, whole);
    const lapsing = unread.some((entry) => now - Date.parse(entry.at) >= READ_DEADLINE_MS);
    const asking = lapsing && turn !== undefined && (yield* this.asking(threadId, turn.run));
    yield* this.store.change(
      threadId,
      (standing, unit) =>
        Effect.gen(function* () {
          const verdict = decideWatch(standing, {
            now,
            seen,
            seenInTurn,
            ending,
            message,
            endedRun: turn?.run ?? null,
            settling: options.settling === true,
            asking,
            absent,
            idle: options.idle ?? null,
          });
          const reports = journal.reports;
          const plans: ReportPlan[] = [
            ...verdict.read.map((each) => reports.fate({ id: each.run, threadId }, 'read', each.items)),
            ...verdict.lapsed.map((each) => reports.lapsed({ id: each.run, threadId }, each.items)),
          ];
          const { unread: _before, ...kept } = standing;
          let next: ExternalSession = verdict.unread.length === 0 ? kept : { ...kept, unread: verdict.unread };
          if (verdict.end !== null) {
            const run = { id: verdict.end.run, threadId };
            if (verdict.end.message !== null && verdict.end.ending.kind === 'completed') {
              plans.push(
                reports.recorded(
                  run,
                  [assistantWords(run.id, verdict.end.spoke, verdict.end.message, new Date(now).toISOString())],
                  `tail:${run.id}`,
                ),
              );
            }
            plans.push(...closing.close(run, verdict.end.ending, spent));
            const { turn: _gone, ...rest } = next;
            const lastTurn = verdict.end === null || turn === undefined || turn.turn === null || turn.turn === '' ? undefined : turn.turn;
            const settled = closedWords(journal, threadId, lastTurn === undefined ? rest : { ...rest, lastTurn }, run.id);
            plans.push(...settled.plans);
            next =
              harnessAdapter(standing.name).ends.interrupt === 'record'
                ? armedConfirmed(settled.facet, new Date(now).toISOString())
                : settled.facet;
            yield* unit.afterCommit(Effect.sync(() => open.drop(run.id)));
          }
          if (plans.length === 0) return { facet: standing, value: undefined };
          yield* journal.apply(unit, plans);
          const current = next.turn;
          if (current !== undefined && verdict.lapsed.some((each) => each.run === current.run)) {
            const running = yield* threads.runningRun(threadId, unit);
            if (running !== current.run) {
              const { turn: _withdrawn, ...rest } = next;
              next = rest;
              yield* unit.afterCommit(Effect.sync(() => open.drop(current.run)));
            }
          }
          return { facet: next, value: undefined };
        }).pipe(Effect.mapError((cause): HarnessFailure => cause as unknown as HarnessFailure)),
      journal.writes,
    );
  });
}
