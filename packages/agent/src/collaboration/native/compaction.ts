import { Clock, Effect, Layer } from 'effect';
import type { ThreadCompactionEntry, ThreadSummarizerSkip } from '../../transcript/entries';
import { entryOf } from '../../transcript/kinds';
import { barrierIdAhead, behindBarrierId } from '../../thread/inboxItems';
import type { ThreadRow } from '../../thread/rows';
import { currentRunOf } from '../../thread/state';
import { RunScheduler } from '../../thread/run/scheduler/RunScheduler';
import { ThreadCompactor } from '../../thread/run/ThreadCompaction';
import { ThreadRunLedger } from '../../thread/run/ThreadRunLedger';
import { ThreadNotFoundError } from '../../thread/storage/aggregate';
import {
  ThreadCompactionConflictError,
  ThreadCompactionExhaustedError,
  ThreadCompactionOffError,
  ThreadNoSummarizerError,
  ThreadSummaryFailedError,
} from '../../thread/storage/compaction';
import { ThreadRunConflictError } from '../../thread/storage/runs';
import { type ThreadBorderFailed, ThreadMissing, storageFailed, threadCauseOf } from '../../thread/ThreadBorder';
import { ThreadLeaseRhythm, ThreadInbox, ThreadStore, ThreadTransitions } from '../../thread/ThreadPorts';
import {
  ContextCompaction,
  type ContextCompactionFailure,
  SummarizerMissing,
  ThreadCompactionConflict,
  ThreadCompactionRefused,
} from '../compaction';
import type { ThreadChildSummarizer } from '../ThreadPlaneAccess';
import { foundThread, startedBy, startKeyed } from './runs';
function compactionWord(entry: ThreadCompactionEntry | undefined): 'completed' | 'unchanged' | 'failed' | 'aborted' {
  switch (entry?.status) {
    case 'completed':
    case 'unchanged':
    case 'failed':
    case 'aborted':
      return entry.status;
    default:
      return 'failed';
  }
}
function compactionOutcome(
  entries: readonly {
    readonly type: string;
    readonly id: string;
  }[],
  runId: string,
): {
  status: 'completed' | 'unchanged' | 'failed' | 'aborted';
  summarizer: ThreadChildSummarizer | null;
  skipped: readonly ThreadSummarizerSkip[];
} {
  const entry = entries.filter(entryOf('compaction')).find((compaction) => compaction.runId === runId);
  const summarizer = entry?.summarizer;
  return {
    status: compactionWord(entry),
    summarizer:
      summarizer === undefined
        ? null
        : {
            provider: summarizer.provider,
            model: summarizer.model,
            reasoning: summarizer.reasoning,
            account: summarizer.account ?? null,
            own: summarizer.own,
            reason: summarizer.reason,
          },
    skipped: summarizer?.skipped ?? entry?.noSummarizer?.skipped ?? [],
  };
}
function compactionFailure(threadId: string, call: string): (failure: ThreadBorderFailed) => ContextCompactionFailure {
  return (failure) => {
    const cause = threadCauseOf(failure);
    if (cause instanceof ThreadNotFoundError) return new ThreadMissing({ threadId });
    if (cause instanceof ThreadCompactionExhaustedError) {
      return new ThreadCompactionRefused({ threadId, reason: 'exhausted', running: null });
    }
    if (cause instanceof ThreadNoSummarizerError) return new SummarizerMissing({ threadId, skipped: cause.skipped });
    if (cause instanceof ThreadCompactionOffError) return new ThreadCompactionRefused({ threadId, reason: 'off', running: null });
    if (cause instanceof ThreadSummaryFailedError)
      return new ThreadCompactionRefused({ threadId, reason: 'summary-failed', running: null });
    if (cause instanceof ThreadCompactionConflictError) {
      return new ThreadCompactionConflict({ threadId, reason: 'prefix-moved', key: null });
    }
    if (cause instanceof ThreadRunConflictError) {
      return new ThreadCompactionRefused({ threadId, reason: 'running', running: null });
    }
    return storageFailed(call)(failure);
  };
}
export const nativeContextCompactionLayer: Layer.Layer<
  ContextCompaction,
  never,
  RunScheduler | ThreadCompactor | ThreadLeaseRhythm | ThreadInbox | ThreadRunLedger | ThreadStore | ThreadTransitions
> = Layer.effect(
  ContextCompaction,
  Effect.gen(function* () {
    const compactor = yield* ThreadCompactor;
    const inbox = yield* ThreadInbox;
    const scheduler = yield* RunScheduler;
    const ledger = yield* ThreadRunLedger;
    const lease = yield* ThreadLeaseRhythm;
    const store = yield* ThreadStore;
    const transitions = yield* ThreadTransitions;
    const target = (threadId: string) => foundThread(store, threadId);
    const running = Effect.fnUntraced(function* (child: ThreadRow) {
      const active = yield* ledger.activeRun(child.id);
      return yield* new ThreadCompactionRefused({
        threadId: child.id,
        reason: 'running',
        running: active ? currentRunOf(active, child, new Date(yield* Clock.currentTimeMillis), lease) : null,
      });
    });
    return {
      choosesSummarizer: compactor.choosesSummarizer === true,
      summarizer: (threadId) =>
        Effect.flatMap(target(threadId), (child) =>
          compactor
            .summarizing({
              threadId: child.id,
              provider: child.provider,
              model: child.model,
              running: false,
              compaction: child.capabilities.compaction,
            })
            .pipe(
              Effect.map((summarizing) =>
                compactor.intended({ provider: child.provider, model: child.model, reasoning: child.reasoning }, summarizing).own
                  ? ('own' as const)
                  : ('foreign' as const),
              ),
              Effect.catchIf(
                (failure) => failure instanceof ThreadNoSummarizerError,
                () => Effect.succeed('none' as const),
              ),
            ),
        ).pipe(
          Effect.catch((failure) =>
            Effect.fail(failure instanceof ThreadMissing ? failure : compactionFailure(threadId, 'compaction.summarizer')(failure)),
          ),
        ),
      compact: Effect.fn('ContextCompaction.compact')(
        function* (threadId, input) {
          const child = yield* target(threadId);
          const key = startKeyed(child.id, input.request.key, ['compact', input.keep ?? null, input.at ?? null, input.summarizer ?? null]);
          const started = yield* startedBy(transitions, child.id, key).pipe(
            Effect.catchTag('ThreadRunConflict', () =>
              Effect.fail(new ThreadCompactionConflict({ threadId, reason: 'act-id-reused', key: input.request.key })),
            ),
          );
          if (started !== null && !('runId' in started)) return started;
          if (started !== null) {
            const standing = (yield* ledger.activeRun(child.id))?.id === started.runId;
            if (standing) return { status: 'joined' as const, runId: started.runId };
            const length = child.history.length;
            return {
              ...compactionOutcome(yield* store.entriesOfRun(child.id, started.runId), started.runId),
              runId: started.runId,
              history: { before: length, after: length },
              acted: false,
            };
          }
          if (input.at === undefined) {
            const active = yield* ledger.activeRun(child.id);
            if (active) return yield* running(child);
          }
          const before = child.history.length;
          const asked = yield* scheduler
            .admit(child, {
              kind: 'compact',
              ask: {
                keep: input.keep,
                at: input.at,
                summarizer: input.summarizer,
                startKey: { key: input.request.key, digest: key.digest },
              },
            })
            .pipe(
              Effect.catchIf(
                (failure) => input.at === undefined && threadCauseOf(failure) instanceof ThreadRunConflictError,
                () => running(child),
              ),
            );
          if (asked.status === 'requested') {
            return {
              status: 'requested' as const,
              requestId: asked.request.id,
              at: asked.request.body.at,
              runId: asked.runId,
              acted: true,
            };
          }
          if (asked.status === 'joined') return { status: 'joined' as const, runId: asked.runId };
          yield* Effect.exit(asked.done);
          const entries = yield* store.entriesOfRun(child.id, asked.run.id);
          const after = (yield* store.find(child.id))?.history.length ?? before;
          return {
            ...compactionOutcome(entries, asked.run.id),
            runId: asked.run.id,
            history: { before, after },
            acted: true,
          };
        },
        (effect, threadId, input) =>
          effect.pipe(
            Effect.catch((failure) =>
              failure instanceof ThreadMissing || failure instanceof ThreadCompactionRefused || failure instanceof ThreadCompactionConflict
                ? Effect.fail(failure)
                : Effect.fail(compactionFailure(threadId, 'compaction.compact')(failure)),
            ),
          ),
      ),
      compactAhead: Effect.fn('ContextCompaction.compactAhead')(
        function* (threadId, input) {
          const recipient = yield* target(threadId);
          const key = startKeyed(recipient.id, input.item.id, ['compact-ahead', input.keep]);
          const started = yield* startedBy(transitions, recipient.id, key).pipe(
            Effect.catchTag('ThreadRunConflict', () =>
              Effect.fail(new ThreadCompactionConflict({ threadId, reason: 'act-id-reused', key: input.item.id })),
            ),
          );
          const summarizerOf = (runId: string) =>
            Effect.map(store.entriesOfRun(recipient.id, runId), (entries) => compactionOutcome(entries, runId).summarizer);
          if (started !== null && 'runId' in started) {
            const requestId = barrierIdAhead(input.item);
            const itemId = behindBarrierId(requestId, input.item.id);
            if ((yield* inbox.receipt(itemId)) !== undefined) {
              const summarizer = yield* summarizerOf(started.runId);
              return { requestId, itemId, runId: started.runId, started: true, summarizer, acted: false };
            }
          }
          const asked = yield* scheduler.admit(recipient, {
            kind: 'compact-ahead',
            keep: input.keep,
            item: input.item,
            startKey: { key: input.item.id, digest: key.digest },
          });
          const summarizer = asked.started && asked.runId !== null ? yield* summarizerOf(asked.runId) : null;
          return { ...asked, summarizer, acted: true };
        },
        (effect, threadId, input) =>
          effect.pipe(
            Effect.catch((failure) =>
              failure instanceof ThreadMissing || failure instanceof ThreadCompactionConflict
                ? Effect.fail(failure)
                : Effect.fail(compactionFailure(threadId, 'compaction.compactAhead')(failure)),
            ),
          ),
      ),
    };
  }),
);
