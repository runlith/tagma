import { Effect } from 'effect';
import { note } from '@runlith/activity/Activity';
import { AgentHostFailed } from '../../../agent/AgentFailure';
import type { ThreadSignal } from '../../../transcript/parts';
import { attachmentParts, threadSignalEvent } from '../../events';
import { actDigest } from '../../keyed';
import { ThreadRunConflictError } from '../../storage/runs';
import type { ThreadSignalDrain } from '../../agents/ThreadAgent';
import { type ThreadBorderFailed, type ThreadPortFailure } from '../../ThreadBorder';
import { ThreadAttachments, ThreadInbox, ThreadOwner, type ThreadTx, type ThreadWriteTx } from '../../ThreadPorts';
import { answerOf, transitionNow, type TransitionDeps } from '../../transition/kernel';
import type { Decision } from '../../transition/port';
import type { RunNote } from '../notes';
import { ThreadRunInbox } from '../ThreadRunInbox';
import { ThreadRunLedger } from '../ThreadRunLedger';

export type RunSignalPort = {
  readonly port: ThreadSignalDrain;
  release(): void;
};

export const makeRunSignals = Effect.fnUntraced(function* ({ kernel }: { readonly kernel: TransitionDeps<ThreadTx, ThreadWriteTx> }) {
  const runInbox = yield* ThreadRunInbox;
  const attachments = yield* ThreadAttachments;
  const inbox = yield* ThreadInbox;
  const ledger = yield* ThreadRunLedger;
  const owner = yield* ThreadOwner;

  const drain = Effect.fnUntraced(function* (
    threadId: string,
    ownerId: string,
    runId: string,
    flushRecorded: Effect.Effect<void, ThreadBorderFailed> | undefined,
    onSignalsDelivered: ((signals: readonly ThreadSignal[]) => Effect.Effect<void, ThreadBorderFailed>) | undefined,
  ): Effect.fn.Return<readonly ThreadSignal[], ThreadBorderFailed> {
    const ref = { id: runId, threadId };
    if (!(yield* runInbox.hasPending(ref))) return [];
    yield* (flushRecorded ?? Effect.void).pipe(Effect.retry({ times: 1 }));
    const read = yield* runInbox.read(ref);
    const taken = yield* Effect.forEach(read, (signal) =>
      signal.attachments?.length
        ? Effect.map(attachments.resolve(threadId, ownerId, signal.attachments), (stored) => ({
            signal: { ...signal, attached: attachmentParts(stored) } satisfies ThreadSignal,
            fact: threadSignalEvent(signal, runId, { attachments: stored }),
          }))
        : Effect.succeed({ signal, fact: threadSignalEvent(signal, runId) }),
    );
    type Reading = typeof taken;
    const still: Reading =
      taken.length === 0
        ? []
        : yield* Effect.flatMap(
            transitionNow<Reading, ThreadWriteTx, ThreadPortFailure>(
              kernel,
              threadId,
              {
                declared: [],
                decide: Effect.fnUntraced(function* (view, tx) {
                  const active = yield* ledger.latestRun(threadId, ['running'], tx);
                  if (active?.id !== runId || active.ownerId !== owner.id) {
                    return yield* Effect.fail(new ThreadRunConflictError({ threadId, runId: active?.id ?? runId }));
                  }
                  const queued = new Set(
                    (yield* inbox.pending(threadId, tx)).filter((item) => item.state === 'queued').map((item) => item.id),
                  );
                  const reading = taken.filter((each) => queued.has(each.signal.id));
                  if (reading.length === 0) return { replayed: reading } as Decision<Reading, ThreadWriteTx, ThreadPortFailure>;
                  return {
                    apply: true,
                    result: reading.map((each, index) => ({
                      ...each,
                      signal: { ...each.signal, readerPosition: view.version.head + index + 1 },
                    })),
                    events: reading.map((each) => each.fact),
                    participants: (unit) =>
                      inbox.acknowledge(
                        reading.map((each) => each.signal.id),
                        runId,
                        unit,
                      ),
                  } as Decision<Reading, ThreadWriteTx, ThreadPortFailure>;
                }),
              },
              { evidence: { inboxItem: taken[0]!.signal.id, run: runId }, digest: actDigest(taken.map((each) => each.signal.id)) },
            ),
            (outcome) => answerOf(threadId, outcome),
          );
    const delivered = still.map((each) => each.signal);
    if (delivered.length > 0) {
      yield* note<RunNote>({ type: 'signals-read', signals: delivered.map((signal) => signal.id) }, { run: runId });
      yield* (onSignalsDelivered?.(delivered) ?? Effect.void).pipe(Effect.ignore);
    }
    return delivered;
  });

  return {
    of: (
      threadId: string,
      ownerId: string,
      runId: string,
      keepWarm: boolean,
      flushRecorded: Effect.Effect<void, ThreadBorderFailed> | undefined,
      onSignalsDelivered: ((signals: readonly ThreadSignal[]) => Effect.Effect<void, ThreadBorderFailed>) | undefined,
    ): RunSignalPort => {
      const ref = { id: runId, threadId };
      if (keepWarm) runInbox.forget(runId);
      const queue = keepWarm ? null : runInbox.signalQueue(runId);
      return {
        port: {
          hasPending: () =>
            runInbox.asksStep(ref).pipe(Effect.mapError((cause) => new AgentHostFailed({ port: 'signals.hasPending', cause }))),
          drain: () =>
            drain(threadId, ownerId, runId, flushRecorded, onSignalsDelivered).pipe(
              Effect.mapError((cause) => new AgentHostFailed({ port: 'signals.drain', cause })),
            ),
          arrivals: queue === null ? undefined : { subscribe: (listener) => queue.subscribe(listener), unread: () => queue.unread() },
        },
        release: () => queue?.dispose(),
      };
    },
  };
});
