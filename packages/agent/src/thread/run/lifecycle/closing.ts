import { Clock, Effect } from 'effect';
import { opensTurnMessage } from '../../../agent/AgentSignal';
import type { ThreadInterruptedInput, WithdrawnWords } from '../../../transcript/entries';
import { coreEntry } from '../../../transcript/kinds';
import { KEEP_WARM_SIGNAL_TYPE } from '../../../transcript/keepWarm';
import type { ThreadTranscript } from '../../../transcript/rows';
import type { RunEndStatus } from '../../../transcript/live';
import { EndingStages, type RunEnded } from '../../ending';
import {
  type ThreadEventBody,
  type ThreadInterruptionMark,
  threadRunEndEvent,
  threadTailEvents,
  threadUserMessageEvent,
  threadWithdrawalEvent,
} from '../../events';
import { opensTurnEntry } from '../../rewind';
import { isReaderWordsItem, isUnreadSteer, queuedTurnText } from '../../inboxItems';
import { actDigest, type Keyed, type TransitionOutcome } from '../../keyed';
import { ThreadStorageFailed } from '../../persisted';
import type { ThreadContextReading, ThreadRow, ThreadRunRow } from '../../rows';
import type { ThreadRunStorage } from '../../storage/runs';
import type { ThreadPortFailure } from '../../ThreadBorder';
import { ThreadAttachments, ThreadInbox, ThreadToolOutputVault, type ThreadTx, type ThreadWriteTx } from '../../ThreadPorts';
import { answerOf, prepareTransition, transitionIn, transitionNow, type TransitionDeps } from '../../transition/kernel';
import type { Decision, TransitionPlan, TransitionView } from '../../transition/port';
import { routedEntry } from '../routedQuestions';
import { unsettledCallEvents } from '../ThreadEffectSettlement';
import type { ThreadRunRef } from '../ThreadRunLedger';

export type ThreadStatusMark = { readonly status: 'idle' | 'running' | 'failed'; readonly failureReason: string | null };

export const IDLE_THREAD: ThreadStatusMark = { status: 'idle', failureReason: null };

export type EndAct = {
  readonly write: (tx?: ThreadWriteTx) => Effect.Effect<ThreadRunRow | null, ThreadPortFailure>;
  readonly key: Keyed;
  readonly interruption?: (settled: ThreadRunRow) => 'steers' | 'plain' | null;
  readonly mark?: (settled: ThreadRunRow) => ThreadStatusMark;
  readonly returnsWords?: true;
  readonly answered?: true;
  readonly unsettled?: string;
  readonly ending?: (settled: ThreadRunRow, thread: ThreadRow, ofRun: ThreadTranscript, unreadSteers: number) => readonly ThreadEventBody[];
};

export type EndPlan = EndAct | ((tx: ThreadWriteTx) => Effect.Effect<EndAct, ThreadPortFailure>);

export type EndAnswer = { readonly committed: ThreadRunRow } | { readonly replayed: ThreadRunRow };

export type EndDecision = {
  readonly settled: ThreadRunRow;
  readonly events: readonly ThreadEventBody[];
  readonly participants: (unit: ThreadWriteTx) => Effect.Effect<void, ThreadPortFailure>;
};

export type EndStatus = RunEndStatus;

export function endKey(runId: string, status: EndStatus): Keyed {
  return { evidence: { runEnd: runId, status }, digest: actDigest(['runEnd', runId, status]) };
}

export function adoptKey(runId: string): Keyed {
  return { evidence: { decidedBy: `adopt:${runId}` }, digest: actDigest(['adopt', runId]) };
}

type EndTransition = Decision<string | null, ThreadWriteTx, ThreadPortFailure>;

export const makeRunClosing = Effect.fnUntraced(function* ({
  kernel,
  runs,
}: {
  readonly kernel: TransitionDeps<ThreadTx, ThreadWriteTx>;
  readonly runs: ThreadRunStorage<ThreadTx, ThreadWriteTx>;
}) {
  const inbox = yield* ThreadInbox;
  const attachments = yield* ThreadAttachments;
  const endings = yield* EndingStages;
  const outputs = yield* ThreadToolOutputVault;

  const decideEnd = Effect.fnUntraced(function* (
    run: ThreadRunRef,
    act: EndAct,
    view: TransitionView,
    tx: ThreadWriteTx,
  ): Effect.fn.Return<EndDecision | null, ThreadPortFailure> {
    const written = yield* act.write(tx);
    if (!written) return null;
    const row = view.row;
    const tail = written.streamTail;
    const ofRun = yield* kernel.store.entriesOfRun(run.threadId, run.id, tx);
    const pending = yield* inbox.pending(run.threadId, tx);
    const hasReaderOpening = ofRun.some(
      (entry) => coreEntry(entry) && opensTurnEntry(entry) && (entry.type !== 'signal' || entry.addressee === 'reader'),
    );
    const unprompted =
      written.status === 'aborted' && !hasReaderOpening
        ? pending.filter((item) => item.state === 'delivered' && item.deliveredToRunId === run.id && isReaderWordsItem(item))
        : [];
    const withdrawsReader = unprompted.length > 0 && written.stopRequest?.withdraw === true;
    const unread = pending.filter(isUnreadSteer).length;
    const shape = act.interruption?.(written) ?? null;
    const interruption: ThreadInterruptionMark | null = shape === 'steers' ? { steers: unread } : shape === 'plain' ? { steers: 0 } : null;
    const events = [
      ...(tail && tail.length > 0 ? threadTailEvents(run.id, tail, interruption) : []),
      ...(written.status === 'running'
        ? []
        : unsettledCallEvents(
            run.id,
            [...ofRun, ...(tail ?? [])],
            row.history,
            row.pendingInteraction !== null && routedEntry(row.pendingInteraction) ? null : row.pendingInteraction,
            act.unsettled,
          )),
      ...(withdrawsReader ? [threadWithdrawalEvent(run.id, row.history.length)] : (act.ending?.(written, row, ofRun, unread) ?? [])),
    ];
    const refs = unprompted.flatMap((item) => (item.kind === 'turn' || item.kind === 'signal' ? (item.body.attachments ?? []) : []));
    const stored = refs.length === 0 ? [] : yield* attachments.resolve(run.threadId, row.ownerId, refs);
    const text = queuedTurnText(unprompted);
    const draft = withdrawsReader
      ? {
          text,
          attachments:
            stored.length === 0 ? undefined : stored.map((file) => ({ mime: file.mediaType, url: file.url, filename: file.filename })),
        }
      : null;
    if (unprompted.length > 0 && draft === null) {
      const said = threadUserMessageEvent(run, { text, attachments: stored, reader: true });
      events.unshift({
        ...said,
        payload: { ...said.payload, entry: { ...said.payload.entry, occurredAt: written.startedAt.toISOString() } },
      });
    }
    const withdrawn =
      draft !== null || events.some((event) => event.payload.withdrawn)
        ? yield* runs.withdrawRun(run.id, draft ?? wordsOf(ofRun), tx)
        : null;
    const settled = withdrawn === null ? written : { ...withdrawn, streamTail: tail };
    const closing = threadRunEndEvent(settled, row.contextReading);
    if (closing) events.push(closing);
    const mark = act.mark?.(settled);
    const decision: EndDecision = {
      settled,
      events,
      participants: Effect.fnUntraced(function* (unit) {
        const open = openInputsOf(tail);
        if (open.length > 0) yield* outputs.settleOpen(run.threadId, open);
        let returned = act.returnsWords ? yield* inbox.returnTo(run.id, unit) : null;
        if (written.kind === 'keep-warm' && returned !== null) {
          const warming: string[] = [];
          const unread: string[] = [];
          for (const id of returned) {
            const item = yield* inbox.receipt(id, unit);
            if (item?.kind === 'signal' && item.body.type === KEEP_WARM_SIGNAL_TYPE) warming.push(id);
            else unread.push(id);
          }
          if (warming.length > 0) yield* inbox.acknowledge(warming, run.id, unit);
          returned = unread;
        }
        if (mark) {
          yield* runs.markStatus(
            {
              threadId: run.threadId,
              status: mark.status,
              failureReason: mark.failureReason,
              updatedAt: new Date(yield* Clock.currentTimeMillis),
            },
            unit,
          );
        }
        if (settled.status !== 'running') {
          let handled = returned;
          if (unprompted.length > 0) {
            handled = unprompted.map((item) => item.id);
            yield* inbox.acknowledge(handled, run.id, unit);
          }
          if (settled.status === 'completed' || act.answered === true) {
            const taken = pending.filter((item) => item.state === 'delivered' && item.deliveredToRunId === run.id);
            const unconfirmed = taken.length === 0 ? new Set<string>() : new Set(yield* inbox.unconfirmed(run.threadId, run.id, unit));
            handled = taken.filter((item) => !unconfirmed.has(item.id)).map((item) => item.id);
            if (handled.length > 0) yield* inbox.acknowledge(handled, run.id, unit);
          }
          yield* endings.record({ ...runEnded(settled, row.ownerId, [...ofRun, ...(tail ?? [])], row.contextReading), handled }, unit);
        }
      }),
    };
    return decision;
  });

  const drive = Effect.fnUntraced(function* (
    run: ThreadRunRef,
    act: EndAct,
    transit: (
      plan: TransitionPlan<string | null, ThreadWriteTx, ThreadPortFailure>,
      key: Keyed,
    ) => Effect.Effect<TransitionOutcome<string | null>, ThreadPortFailure>,
    tx: ThreadWriteTx | undefined,
  ): Effect.fn.Return<EndAnswer | null, ThreadPortFailure> {
    const landed: { settled: ThreadRunRow | null } = { settled: null };
    const outcome = yield* transit(
      {
        declared: [],
        decide: (view, unit) =>
          Effect.map(decideEnd(run, act, view, unit), (decided): EndTransition => {
            landed.settled = decided?.settled ?? null;
            return decided === null
              ? { refuse: null }
              : { apply: true, result: decided.settled.id, events: decided.events, participants: decided.participants };
          }),
      },
      act.key,
    ).pipe(
      Effect.map((answered) => ({ answered })),
      Effect.catchTag('ThreadNotFound', () => Effect.succeed({ answered: null })),
    );
    if (outcome.answered === null) {
      const written = yield* act.write(tx);
      return written === null ? null : { committed: written };
    }
    if ('committed' in outcome.answered) return landed.settled === null ? null : { committed: landed.settled };
    const settledId = yield* answerOf(run.threadId, outcome.answered);
    if (settledId === null) return null;
    const replayed = yield* runs.runById(settledId, tx);
    return replayed === null ? null : { replayed };
  });

  const closeIn = (run: ThreadRunRef, plan: EndPlan, tx: ThreadWriteTx): Effect.Effect<EndAnswer | null, ThreadPortFailure> =>
    Effect.flatMap(typeof plan === 'function' ? plan(tx) : Effect.succeed(plan), (act) =>
      drive(
        run,
        act,
        (plan, key) =>
          Effect.flatMap(prepareTransition(kernel, run.threadId, [], tx), (prepared) => transitionIn(kernel, tx, prepared, plan, key)),
        tx,
      ),
    );

  const close = (run: ThreadRunRef, plan: EndPlan): Effect.Effect<EndAnswer | null, ThreadPortFailure> =>
    typeof plan !== 'function'
      ? drive(run, plan, (plan, key) => transitionNow(kernel, run.threadId, plan, key), undefined)
      : Effect.gen(function* () {
          const admitted = yield* kernel.lane.enter(
            run.threadId,
            kernel.lane.place(),
            kernel.transitions.writeAt(run.threadId, (at) => closeIn(run, plan, at.tx)),
          );
          if ('ran' in admitted) return admitted.ran ?? null;
          return yield* new ThreadStorageFailed({
            call: 'run.end',
            cause: new Error(
              `Thread ${run.threadId}: ending ${run.id} stopped before its write answered; whether it committed is unknown; read the run before another act.`,
            ),
          });
        });

  return { close, closeIn, decideEnd };
});

export function withdrawnTurn(run: ThreadRunRow, thread: ThreadRow, ofRun: ThreadTranscript): readonly ThreadEventBody[] {
  return wordsOfTurn(run, ofRun) === 1 ? turnWithdrawal(run, thread) : [];
}

export function wordsOnly(run: ThreadRunRow, ofRun: ThreadTranscript): boolean {
  return wordsOfTurn(run, ofRun) === 1;
}

export function displacedTurn(run: ThreadRunRow, thread: ThreadRow, ofRun: ThreadTranscript): readonly ThreadEventBody[] {
  const said = wordsOfTurn(run, ofRun);
  if (said === 0) return [threadWithdrawalEvent(run.id, thread.history.length)];
  return said === 1 ? turnWithdrawal(run, thread) : [];
}

function turnWithdrawal(run: ThreadRunRow, thread: ThreadRow): readonly ThreadEventBody[] {
  const from = thread.history.findLastIndex(opensTurnMessage);
  return from < 0 ? [] : [threadWithdrawalEvent(run.id, from)];
}

function wordsOf(ofRun: ThreadTranscript): WithdrawnWords | null {
  const opening = ofRun.find(opensTurnEntry);
  if (opening === undefined || !coreEntry(opening) || (opening.type !== 'message' && opening.type !== 'signal')) return null;
  return { text: opening.text, attachments: opening.type === 'message' ? opening.attachments : undefined };
}

function wordsOfTurn(run: ThreadRunRow, ofRun: ThreadTranscript): number | null {
  if ((run.streamTail ?? []).some((entry) => !answersNothing(entry))) return null;
  let wordsSaid = 0;
  for (const entry of ofRun) {
    if (answersNothing(entry)) continue;
    if (!opensTurnEntry(entry)) return null;
    wordsSaid += 1;
  }
  return wordsSaid;
}

export function runEnded(
  settled: ThreadRunRow,
  principal: string,
  ofRun: ThreadTranscript,
  reading: ThreadContextReading | null,
): RunEnded {
  const status = settled.status === 'running' ? 'failed' : settled.status;
  return {
    threadId: settled.threadId,
    principal,
    runId: settled.id,
    ending: settled.id,
    kind: 'ended',
    status,
    stoppedBy: settled.settledBy,
    work: settled.kind,
    handled: null,
    answer: status === 'completed' ? closingAnswer(ofRun) : null,
    report: null,
    failure: settled.failure,
    failureReason: settled.failureReason,
    reading: reading?.runId === settled.id ? reading : null,
  };
}

function closingAnswer(entries: ThreadTranscript): string | null {
  const closing: string[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (!coreEntry(entry)) continue;
    if (entry.type === 'tool' && closing.length > 0) break;
    if (entry.type !== 'message') continue;
    if (entry.role === 'assistant' && entry.text.trim() !== '') closing.unshift(entry.text);
  }
  return closing.length === 0 ? null : closing.join('\n\n');
}

function openInputsOf(tail: ThreadTranscript | null): readonly ThreadInterruptedInput[] {
  return (tail ?? []).flatMap((entry) => {
    if (!coreEntry(entry) || entry.type !== 'tool' || entry.toolState !== 'input-streaming') return [];
    const raw = entry.toolInputRaw;
    return raw?.kind === 'retained' ? [raw] : [];
  });
}

function answersNothing(entry: ThreadTranscript[number]): boolean {
  return (
    entry.type === 'system-prompt' ||
    entry.type === 'context' ||
    entry.type === 'composition' ||
    entry.type === 'reasoning' ||
    entry.type === 'runtime-guidance'
  );
}
