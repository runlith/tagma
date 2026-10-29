import { Effect } from 'effect';
import { WorkerUnavailable, eventReason, workerGone } from '@runlith/utils/worker';
import type { ThreadCompactionCheckpointRow, ThreadHistory } from '@runlith/agent/thread/rows';
import type { ThreadPrunedVolume } from '@runlith/agent/thread/storage/compaction';
import type { ThreadEntryReader, ThreadReaderWorker } from '@runlith/agent/transcript/kinds';
import { RolloutUnreadable } from '../../threads/journal/rolloutFile.js';
import type { RolloutFiles, TranscriptKey } from '../../threads/contract/service/rested.js';
import { RolloutReads, type RolloutRead, type ReadRollout } from '../../threads/contract/service/rolloutReads.js';

export const TRANSCRIPT_FOOTER_BYTES = 48;
export const TRANSCRIPT_SLOT_BYTES = 16;
export const TRANSCRIPT_OPEN_BYTES = 24;
export const TRANSCRIPT_FORM = 2;

export type RestedCompaction = {
  readonly bytes: number;
  readonly checkpoints: number;
  readonly latest: ThreadCompactionCheckpointRow | null;
  readonly calls: readonly string[];
  readonly pruned: ThreadPrunedVolume;
};

export type RestedAsk = { readonly id: number; readonly rollout: RolloutFiles } & (
  | { readonly kind: 'transcribe'; readonly key: TranscriptKey }
  | { readonly kind: 'history' }
  | { readonly kind: 'compaction' }
);

export type RestedAnswer = { readonly id: number } & (
  | { readonly kind: 'transcribed'; readonly entries: number }
  | { readonly kind: 'history'; readonly history: ThreadHistory; readonly bytes: number }
  | { readonly kind: 'compaction'; readonly summary: RestedCompaction }
  | { readonly kind: 'failed'; readonly reason: string }
);

export type RestedRead = { readonly id: number; readonly kind: 'read'; readonly reads: readonly RolloutRead[] };
type Waiting = { readonly answer: (answer: RestedAnswer | WorkerUnavailable) => void; readonly read: ReadRollout };

type Served = { readonly thread: Worker; readonly waiting: Map<number, Waiting> };

const served = new Map<ThreadReaderWorker, Served>();
let asked = 0;

const WORKER = 'rested fold worker';

const failed = (start: ThreadReaderWorker, standing: Served, reason: string): void => {
  if (served.get(start) !== standing) return;
  served.delete(start);
  standing.thread.terminate();
  const gone = workerGone(WORKER, reason);
  const asks = [...standing.waiting.values()];
  standing.waiting.clear();
  for (const answered of asks) answered.answer(gone);
};

const started = (start: ThreadReaderWorker): Served => {
  const held = served.get(start);
  if (held !== undefined) return held;
  const standing: Served = { thread: start(), waiting: new Map() };
  const { thread, waiting } = standing;
  served.set(start, standing);
  thread.addEventListener('message', (event: MessageEvent<RestedAnswer | RestedRead>) => {
    const answered = waiting.get(event.data.id);
    if (event.data.kind === 'read') {
      for (const read of event.data.reads) answered?.read(read);
      return;
    }
    waiting.delete(event.data.id);
    if (waiting.size === 0) thread.unref();
    answered?.answer(event.data);
  });
  thread.addEventListener('error', (event: ErrorEvent) => failed(start, standing, eventReason(event, 'the rested fold worker failed')));
  thread.addEventListener('messageerror', () => failed(start, standing, 'a rested fold answer could not be read'));
  thread.addEventListener('close', () => failed(start, standing, 'the rested fold worker closed'));
  thread.unref();
  return standing;
};

const ask = (
  kinds: ThreadEntryReader,
  rollout: RolloutFiles,
  asking: (id: number) => RestedAsk,
): Effect.Effect<RestedAnswer, WorkerUnavailable> =>
  Effect.flatMap(RolloutReads, (read) =>
    Effect.callback<RestedAnswer, WorkerUnavailable>((resume) => {
      const start = kinds.worker;
      if (start === null) {
        resume(Effect.fail(workerGone(WORKER, 'its entry reader names no worker that folds with it')));
        return;
      }
      const id = ++asked;
      let standing: Served;
      try {
        standing = started(start);
      } catch (cause) {
        resume(Effect.fail(workerGone(WORKER, `it could not start: ${String(cause)}`)));
        return;
      }
      const { thread, waiting } = standing;
      waiting.set(id, {
        read,
        answer: (answer) => resume(answer instanceof WorkerUnavailable ? Effect.fail(answer) : Effect.succeed(answer)),
      });
      thread.ref();
      try {
        thread.postMessage(asking(id));
      } catch (cause) {
        failed(start, standing, `it took no ask: ${String(cause)}`);
      }
      return Effect.sync(() => {
        waiting.delete(id);
        if (waiting.size === 0) thread.unref();
      });
    }),
  ).pipe(Effect.withSpan('ThreadTranscript.rested.fold', { attributes: { rollout: rollout.path } }));

const unreadable = (rollout: RolloutFiles, answer: RestedAnswer): RolloutUnreadable =>
  new RolloutUnreadable({
    reason: 'io',
    path: rollout.path,
    message: answer.kind === 'failed' ? answer.reason : `the rested fold answered ${answer.kind}`,
  });

export const transcribeRollout = (
  kinds: ThreadEntryReader,
  rollout: RolloutFiles,
  key: TranscriptKey,
): Effect.Effect<number, RolloutUnreadable | WorkerUnavailable> =>
  Effect.flatMap(
    ask(kinds, rollout, (id) => ({ id, rollout, kind: 'transcribe', key })),
    (answer) => (answer.kind === 'transcribed' ? Effect.succeed(answer.entries) : Effect.fail(unreadable(rollout, answer))),
  );

export const readRolloutCompaction = (
  kinds: ThreadEntryReader,
  rollout: RolloutFiles,
): Effect.Effect<RestedCompaction, RolloutUnreadable | WorkerUnavailable> =>
  Effect.flatMap(
    ask(kinds, rollout, (id) => ({ id, rollout, kind: 'compaction' })),
    (answer) => (answer.kind === 'compaction' ? Effect.succeed(answer.summary) : Effect.fail(unreadable(rollout, answer))),
  );

export const foldRolloutHistory = (
  kinds: ThreadEntryReader,
  rollout: RolloutFiles,
): Effect.Effect<{ readonly history: ThreadHistory; readonly bytes: number }, RolloutUnreadable | WorkerUnavailable> =>
  Effect.flatMap(
    ask(kinds, rollout, (id) => ({ id, rollout, kind: 'history' })),
    (answer) =>
      answer.kind === 'history'
        ? Effect.succeed({ history: answer.history, bytes: answer.bytes })
        : Effect.fail(unreadable(rollout, answer)),
  );
