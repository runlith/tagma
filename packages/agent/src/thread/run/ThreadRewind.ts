import { Context, Duration, Effect, Layer } from 'effect';
import { ThreadAttributions } from './ThreadAttributions';
import type { ThreadQueuedTurn } from '../../transcript/live';
import type { ThreadTranscript } from '../../transcript/rows';
import type { ThreadRunStoppedBy } from '../ending';
import type { ThreadEventBody } from '../events';
import { attributionDisagrees, type HistoryAttribution } from '../HistoryAttribution';
import { mintThreadEventId } from '../identity';
import { isReaderWordsItem, threadQueuedTurnOf } from '../inboxItems';
import { actDigest, callKey, type CallerKey, type Keyed } from '../keyed';
import {
  opensTurnEntry,
  ThreadRewindRefusedError,
  type ThreadRestoreAnswer,
  type ThreadRestored,
  type ThreadRewindAnswer,
  type ThreadRewindAsk,
  type ThreadRewindChild,
  type ThreadRewindDraft,
  type ThreadRewindPoints,
  type ThreadRewindPreview,
  type ThreadRewound,
} from '../rewind';
import type { ThreadMetadataRow } from '../rows';
import { ThreadCallBroke, type ThreadBorderFailed } from '../ThreadBorder';
import type { TransportHistory } from '../transport/contract';
import { makeHistoryMoved } from '../transport/moves';
import { Transports } from '../transport/Transports';
import { ThreadEventJournal, ThreadInbox, ThreadStore, ThreadTransitions, type ThreadTx, type ThreadWriteTx } from '../ThreadPorts';
import { answerOf, sameVersion, TRANSITION_PATIENCE_MS, transitionNow } from '../transition/kernel';
import { ThreadJournalLane } from '../transition/lane';
import { ThreadEntryKinds, coreEntry, generatedEntry } from '../../transcript/kinds';
import { ThreadActReusedError, ThreadActSpentError, type Decision, type ThreadVersion } from '../transition/port';
import type { ThreadInboxItem } from '../storage/inbox';
import { ThreadRunConflictError } from '../storage/runs';
import { RunAdmission } from './runAdmission';
import { Questions } from './Questions';
import { ThreadInteractionConflictError } from './ThreadQuestion';
import { ThreadRunLedger } from './ThreadRunLedger';
import { ThreadSnapshots } from './ThreadSnapshots';
import { ThreadStopping } from './ThreadStopping';
export type ThreadRewindInput = ThreadRewindAsk & {
  readonly call?: CallerKey;
  readonly by?: ThreadRunStoppedBy;
};
export type ThreadRestoreInput = {
  readonly rewindId: string;
  readonly call?: CallerKey;
};
export class ThreadRewind extends Context.Service<
  ThreadRewind,
  {
    rewind(threadId: string, ownerId: string, input: ThreadRewindInput): Effect.Effect<ThreadRewindAnswer, ThreadBorderFailed>;
    restore(threadId: string, ownerId: string, input: ThreadRestoreInput): Effect.Effect<ThreadRestoreAnswer, ThreadBorderFailed>;
    preview(threadId: string, ownerId: string, ask: ThreadRewindAsk): Effect.Effect<ThreadRewindPreview, ThreadBorderFailed>;
    points(threadId: string, ownerId: string): Effect.Effect<ThreadRewindPoints, ThreadBorderFailed>;
    draft(threadId: string, ownerId: string, runId: string): Effect.Effect<ThreadRewindDraft | null, ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadRewind') {}
type Attributed = {
  readonly attribution: HistoryAttribution;
  readonly version: ThreadVersion;
};
type Settled<A> =
  | {
      readonly answer: A;
    }
  | {
      readonly moved: true;
    };
const STOP_PATIENCE = Duration.millis(TRANSITION_PATIENCE_MS);
const ACT_ATTEMPTS = 4;
export const makeThreadRewind = Effect.gen(function* () {
  const admission = yield* RunAdmission;
  const store = yield* ThreadStore;
  const transports = yield* Transports;
  const historyOf = (thread: ThreadMetadataRow): Effect.Effect<TransportHistory | null, ThreadBorderFailed> =>
    Effect.map(
      Effect.mapError(transports.of(thread), (cause) => new ThreadCallBroke({ cause })),
      (transport) => transport.history ?? null,
    );
  const journal = yield* ThreadEventJournal;
  const attributions = yield* ThreadAttributions;
  const inbox = yield* ThreadInbox;
  const questions = yield* Questions;
  const ledger = yield* ThreadRunLedger;
  const snapshots = yield* ThreadSnapshots;
  const stopping = yield* ThreadStopping;
  const moved = yield* makeHistoryMoved;
  const kernel = {
    store,
    log: journal,
    transitions: yield* ThreadTransitions,
    lane: yield* ThreadJournalLane,
    kinds: yield* ThreadEntryKinds,
  };
  const owned = Effect.fnUntraced(function* (threadId: string, ownerId: string): Effect.fn.Return<ThreadMetadataRow, ThreadBorderFailed> {
    const thread = yield* store.metadata(threadId);
    if (!thread || thread.ownerId !== ownerId) return yield* new ThreadCallBroke({ cause: new Error(`Thread not found: ${threadId}.`) });
    return thread;
  });
  const attributed = (threadId: string): Effect.Effect<Attributed, ThreadBorderFailed> =>
    Effect.flatMap(
      kernel.transitions.readAt(threadId, ({ version, tx }) =>
        Effect.map(attributions.read(threadId, version.head, tx), (attribution) => ({ attribution, version })),
      ),
      (read) =>
        read === undefined
          ? Effect.fail(new ThreadCallBroke({ cause: new Error(`Thread not found: ${threadId}.`) }))
          : Effect.succeed(read),
    );
  const refused = (error: ThreadRewindRefusedError) => Effect.fail(new ThreadCallBroke({ cause: error }));
  const replayed = Effect.fnUntraced(function* <A>(threadId: string, key: Keyed): Effect.fn.Return<A | null, ThreadBorderFailed> {
    if (!('call' in key.evidence)) return null;
    const reading = yield* kernel.transitions.readRecord(threadId, key.evidence);
    if (reading.kind === 'absent' || reading.kind === 'decided') return null;
    if (reading.kind === 'before-epoch') return yield* Effect.fail(new ThreadActSpentError({ threadId, at: 'before-epoch' }));
    if (reading.digest !== key.digest) return yield* Effect.fail(new ThreadActReusedError({ threadId, evidence: key.evidence }));
    if (reading.kind === 'spent') return yield* Effect.fail(new ThreadActSpentError({ threadId, at: reading.at }));
    if (reading.kind === 'standing') return null;
    return (
      reading.result as {
        readonly answer: A;
      }
    ).answer;
  });
  const settle = Effect.fnUntraced(function* <A>(
    threadId: string,
    key: Keyed,
    read: Attributed,
    decide: (tx: ThreadWriteTx) => Effect.Effect<Decision<Settled<A>, ThreadWriteTx>, ThreadBorderFailed>,
  ): Effect.fn.Return<A | null, ThreadBorderFailed> {
    const outcome = yield* transitionNow<Settled<A>, ThreadWriteTx>(
      kernel,
      threadId,
      {
        declared: [],
        decide: Effect.fnUntraced(function* (view, tx) {
          const moved =
            !sameVersion(view.version, read.version) ||
            view.row.pendingInteraction !== null ||
            (yield* ledger.activeRunIn(threadId, tx)) !== null;
          if (moved) return { refuse: { moved: true } } as Decision<Settled<A>, ThreadWriteTx>;
          if (read.attribution.size !== view.row.history.length) {
            return yield* new ThreadCallBroke({ cause: attributionDisagrees(threadId) });
          }
          return yield* decide(tx);
        }),
      },
      key,
    );
    const settled = yield* answerOf(threadId, outcome);
    return 'answer' in settled ? settled.answer : null;
  });
  const takeable = (
    threadId: string,
    cut: ReadonlySet<string>,
    tx?: ThreadTx,
  ): Effect.Effect<readonly ThreadInboxItem[], ThreadBorderFailed> =>
    Effect.map(inbox.pending(threadId, tx), (items) =>
      items.filter((item) => {
        const words = item.kind === 'turn' || (item.kind === 'signal' && isReaderWordsItem(item));
        if (item.state === 'queued') return words || item.kind === 'compaction';
        return words && item.state === 'delivered' && item.deliveredToRunId !== null && cut.has(item.deliveredToRunId);
      }),
    );
  const stopGoing = Effect.fn('ThreadRewind.stopGoing')(function* (
    thread: ThreadMetadataRow,
    by: ThreadRunStoppedBy,
  ): Effect.fn.Return<string | null, ThreadBorderFailed> {
    const going = yield* ledger.activeRun(thread.id);
    if (going !== null) {
      const stopped = yield* stopping.stop(thread, { door: 'rewind', by, expected: going.id, settled: { within: STOP_PATIENCE } });
      if (stopped.status === 'still-settling') {
        return yield* new ThreadCallBroke({
          cause: new Error(`Run ${going.id} of thread ${thread.id} was still settling when the rewind gave up waiting for it.`),
        });
      }
    }
    const asked = (yield* store.metadata(thread.id))?.pendingInteraction;
    const askedBy = typeof asked?.runId === 'string' ? asked.runId : null;
    if (askedBy !== null && (going === null || askedBy === going.id)) yield* questions.close(thread.id, askedBy, 'Thread run stopped.');
    return going?.id ?? null;
  });
  return ThreadRewind.of({
    rewind: Effect.fn('ThreadRewind.rewind')(function* (threadId, ownerId, input) {
      const thread = yield* owned(threadId, ownerId);
      const rewindId = mintThreadEventId();
      const key: Keyed =
        input.call === undefined
          ? { evidence: { decidedBy: `rewind:${rewindId}` }, digest: actDigest(['rewind', threadId, rewindId]) }
          : {
              evidence: { call: callKey({ operation: 'rewind', ...input.call }) },
              digest: actDigest(['rewind', threadId, input.at, input.scope]),
            };
      const standing = yield* replayed<ThreadRewindAnswer>(threadId, key);
      if (standing !== null) return standing;
      const answer = yield* Effect.acquireUseRelease(
        Effect.sync(() => admission.hold([threadId])),
        () =>
          Effect.gen(function* () {
            let stopped: string | null = null;
            let read: Attributed | undefined;
            const draft = draftOf(yield* store.entriesOfRun(threadId, input.at));
            for (let attempt = 1; attempt <= ACT_ATTEMPTS; attempt += 1) {
              read = yield* attributed(threadId);
              const plan = read.attribution.plan(input.at, input.scope);
              if ('blocked' in plan) return yield* refused(new ThreadRewindRefusedError(plan.blocked, threadId, input.at));
              const asked = (yield* store.metadata(threadId))?.pendingInteraction ?? null;
              if ((yield* ledger.activeRun(threadId)) !== null || asked !== null) {
                stopped = (yield* stopGoing(thread, input.by ?? 'reader')) ?? stopped;
                continue;
              }
              const settled = yield* settle<ThreadRewindAnswer>(
                threadId,
                key,
                read,
                Effect.fnUntraced(function* (tx) {
                  const items = yield* takeable(threadId, new Set(plan.runIds), tx);
                  const holding = stopped ?? (yield* ledger.latestRun(threadId, undefined, tx))?.id ?? '';
                  const rewound: ThreadRewound = { id: rewindId, scope: input.scope, runIds: plan.runIds, cuts: plan.cuts };
                  const answer: ThreadRewindAnswer = {
                    rewindId,
                    scope: input.scope,
                    runIds: plan.runIds,
                    draft,
                    taken: items.map((item): ThreadQueuedTurn => threadQueuedTurnOf(holding, item)),
                    stopped,
                  };
                  return {
                    apply: true,
                    result: { answer },
                    events: [rewindEvent(rewound)],
                    participants:
                      items.length === 0
                        ? undefined
                        : (unit: ThreadWriteTx) =>
                            inbox.acknowledge(
                              items.map((item) => item.id),
                              null,
                              unit,
                            ),
                  } as Decision<Settled<ThreadRewindAnswer>, ThreadWriteTx>;
                }),
              );
              if (settled !== null) return settled;
            }
            return yield* new ThreadCallBroke({
              cause: new Error(`Thread ${threadId} kept moving while it was rewound; nothing was taken out.`),
            });
          }),
        (release) => Effect.sync(release),
      );
      yield* snapshots.publish(threadId);
      yield* moved(threadId, thread);
      return answer;
    }),
    restore: Effect.fn('ThreadRewind.restore')(function* (threadId, ownerId, input) {
      const thread = yield* owned(threadId, ownerId);
      const hosted = yield* historyOf(thread);
      const key: Keyed =
        input.call === undefined
          ? { evidence: { decidedBy: `restore:${input.rewindId}` }, digest: actDigest(['restore', threadId, input.rewindId]) }
          : {
              evidence: { call: callKey({ operation: 'restore', ...input.call }) },
              digest: actDigest(['restore', threadId, input.rewindId]),
            };
      const standing = yield* replayed<ThreadRestoreAnswer>(threadId, key);
      if (standing !== null) return standing;
      let hostedDone = false;
      return yield* Effect.acquireUseRelease(
        Effect.sync(() => admission.hold([threadId])),
        () =>
          Effect.gen(function* () {
            let read: Attributed | undefined;
            for (let attempt = 1; attempt <= ACT_ATTEMPTS; attempt += 1) {
              read = yield* attributed(threadId);
              const plan = read.attribution.restorePlan(input.rewindId);
              if ('refused' in plan) return yield* refused(new ThreadRewindRefusedError(plan.refused, threadId, input.rewindId));
              const going = yield* ledger.activeRun(threadId);
              if (going !== null) return yield* Effect.fail(new ThreadRunConflictError({ threadId, runId: going.id }));
              const asked = (yield* store.metadata(threadId))?.pendingInteraction;
              if (asked) {
                return yield* new ThreadCallBroke({
                  cause: new ThreadInteractionConflictError({
                    threadId,
                    runId: String(asked.runId ?? ''),
                    questionId: String(asked.questionId ?? asked.id),
                    reason: `Thread ${threadId} is waiting for an answer to its question, so no rewind of it is restored until the question is answered or cleared.`,
                  }),
                });
              }
              const inserts = yield* attributions.restore(threadId, plan);
              if (hosted !== null && !hostedDone) {
                yield* hosted.restore(threadId, plan.runIds);
                hostedDone = true;
              }
              const restored: ThreadRestored = { rewindId: input.rewindId, runIds: plan.runIds, inserts };
              const settled = yield* settle<ThreadRestoreAnswer>(threadId, key, read, () =>
                Effect.succeed({
                  apply: true,
                  result: { answer: { rewindId: input.rewindId, runIds: plan.runIds } },
                  events: [restoreEvent(restored)],
                } as Decision<Settled<ThreadRestoreAnswer>, ThreadWriteTx>),
              );
              if (settled !== null) {
                yield* snapshots.publish(threadId);
                yield* moved(threadId, thread);
                return settled;
              }
            }
            return yield* new ThreadCallBroke({
              cause: new Error(`Thread ${threadId} kept moving while its rewind was restored; nothing was put back.`),
            });
          }),
        (release) => Effect.sync(release),
      );
    }),
    preview: Effect.fn('ThreadRewind.preview')(function* (threadId, ownerId, ask) {
      const thread = yield* owned(threadId, ownerId);
      const read = yield* attributed(threadId);
      const plan = read.attribution.plan(ask.at, ask.scope);
      if ('blocked' in plan) return yield* refused(new ThreadRewindRefusedError(plan.blocked, threadId, ask.at));
      const taken = new Set(plan.runIds);
      const going = yield* ledger.activeRun(threadId);
      const holding = going?.id ?? (yield* ledger.latestRun(threadId))?.id ?? '';
      const children: ThreadRewindChild[] = [];
      for (const child of yield* store.listByParent(thread.ownerId, threadId)) {
        if (child.spawnedByRunId === null || !taken.has(child.spawnedByRunId)) continue;
        children.push({ threadId: child.id, name: child.name, running: (yield* ledger.activeRun(child.id)) !== null });
      }
      return {
        at: ask.at,
        scope: ask.scope,
        runIds: plan.runIds,
        turns: read.attribution.turns(plan.runIds),
        draft: draftOf(yield* store.entriesOfRun(threadId, ask.at)),
        running: going?.id ?? null,
        taken: (yield* takeable(threadId, taken)).map((item) => threadQueuedTurnOf(holding, item)),
        children,
        rewriteTokens: read.attribution.rewriteTokens(plan.cuts),
      } satisfies ThreadRewindPreview;
    }),
    points: Effect.fn('ThreadRewind.points')(function* (threadId, ownerId) {
      yield* owned(threadId, ownerId);
      const head = yield* journal.headPosition(threadId);
      return (yield* attributions.read(threadId, head)).points();
    }),
    draft: Effect.fn('ThreadRewind.draft')(function* (threadId, ownerId, runId) {
      yield* owned(threadId, ownerId);
      return draftOf(yield* store.entriesOfRun(threadId, runId));
    }),
  });
});

export const threadRewindLayer = Layer.effect(ThreadRewind, makeThreadRewind);

function rewindEvent(rewound: ThreadRewound): ThreadEventBody {
  return { kind: 'rewind', payload: { rewound } };
}
function restoreEvent(restored: ThreadRestored): ThreadEventBody {
  return { kind: 'restore', payload: { restored } };
}
function draftOf(entries: ThreadTranscript): ThreadRewindDraft | null {
  const answered = entries.findIndex(generatedEntry);
  const said = (answered < 0 ? entries : entries.slice(0, answered)).flatMap((entry) =>
    opensTurnEntry(entry) && coreEntry(entry) && (entry.type === 'message' || entry.type === 'signal') ? [entry] : [],
  );
  if (said.length === 0) return null;
  const attachments = said.flatMap((entry) => entry.attachments ?? []);
  return { text: said.map((entry) => entry.text).join('\n'), attachments: attachments.length > 0 ? attachments : undefined };
}
