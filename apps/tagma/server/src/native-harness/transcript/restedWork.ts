import { Effect } from 'effect';
import { WorkerUnavailable, eventReason, workerGone } from '@runlith/utils/worker';
import type { ThreadCompactionCheckpointRow, ThreadHistory } from '@runlith/agent/thread/rows';
import type { ThreadPrunedVolume } from '@runlith/agent/thread/storage/compaction';
import type { ThreadEntryReader } from '@runlith/agent/transcript/kinds';
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
  | { readonly kind: 'transcribe'; readonly key: TranscriptKey; readonly reader: string }
  | { readonly kind: 'history'; readonly reader: string }
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

let worker: Worker | undefined;
let asked = 0;
const waiting = new Map<number, Waiting>();

const WORKER = 'rested fold worker';

const failed = (thread: Worker, reason: string): void => {
  if (worker !== thread) return;
  worker = undefined;
  thread.terminate();
  const gone = workerGone(WORKER, reason);
  const standing = [...waiting.values()];
  waiting.clear();
  for (const answered of standing) answered.answer(gone);
};

const started = (): Worker => {
  if (worker !== undefined) return worker;
  const thread = new Worker(new URL('./rested.worker.ts', import.meta.url), { type: 'module' });
  worker = thread;
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
  thread.addEventListener('error', (event: ErrorEvent) => failed(thread, eventReason(event, 'the rested fold worker failed')));
  thread.addEventListener('messageerror', () => failed(thread, 'a rested fold answer could not be read'));
  thread.addEventListener('close', () => failed(thread, 'the rested fold worker closed'));
  thread.unref();
  return thread;
};

const loadable = (kinds: ThreadEntryReader): Effect.Effect<string, WorkerUnavailable> =>
  kinds.source === null
    ? Effect.fail(workerGone(WORKER, 'its entry reader names no module the worker can load it from'))
    : Effect.succeed(kinds.source);

const ask = (rollout: RolloutFiles, asking: (id: number) => RestedAsk): Effect.Effect<RestedAnswer, WorkerUnavailable> =>
  Effect.flatMap(RolloutReads, (read) =>
    Effect.callback<RestedAnswer, WorkerUnavailable>((resume) => {
      const id = ++asked;
      let thread: Worker;
      try {
        thread = started();
      } catch (cause) {
        resume(Effect.fail(workerGone(WORKER, `it could not start: ${String(cause)}`)));
        return;
      }
      waiting.set(id, {
        read,
        answer: (answer) => resume(answer instanceof WorkerUnavailable ? Effect.fail(answer) : Effect.succeed(answer)),
      });
      thread.ref();
      try {
        thread.postMessage(asking(id));
      } catch (cause) {
        failed(thread, `it took no ask: ${String(cause)}`);
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
    Effect.flatMap(loadable(kinds), (reader) => ask(rollout, (id) => ({ id, rollout, reader, kind: 'transcribe', key }))),
    (answer) => (answer.kind === 'transcribed' ? Effect.succeed(answer.entries) : Effect.fail(unreadable(rollout, answer))),
  );

export const readRolloutCompaction = (rollout: RolloutFiles): Effect.Effect<RestedCompaction, RolloutUnreadable | WorkerUnavailable> =>
  Effect.flatMap(
    ask(rollout, (id) => ({ id, rollout, kind: 'compaction' })),
    (answer) => (answer.kind === 'compaction' ? Effect.succeed(answer.summary) : Effect.fail(unreadable(rollout, answer))),
  );

export const foldRolloutHistory = (
  kinds: ThreadEntryReader,
  rollout: RolloutFiles,
): Effect.Effect<{ readonly history: ThreadHistory; readonly bytes: number }, RolloutUnreadable | WorkerUnavailable> =>
  Effect.flatMap(
    Effect.flatMap(loadable(kinds), (reader) => ask(rollout, (id) => ({ id, rollout, reader, kind: 'history' }))),
    (answer) =>
      answer.kind === 'history'
        ? Effect.succeed({ history: answer.history, bytes: answer.bytes })
        : Effect.fail(unreadable(rollout, answer)),
  );
