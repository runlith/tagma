import { Effect } from 'effect';
import { type WorkerLink, type WorkerUnavailable, workerGone, workerLink } from '@runlith/utils/worker';
import type { ThreadCompactionCheckpointRow, ThreadHistory } from '@runlith/agent/thread/rows';
import type { ThreadPrunedVolume } from '@runlith/agent/thread/storage/compaction';
import type { ThreadEntryReader, ThreadReaderWorker } from '@runlith/agent/transcript/kinds';
import { RolloutUnreadable } from '../../threads/journal/rolloutFile.js';
import type { RolloutFiles, TranscriptKey } from '../../threads/contract/service/rested.js';
import { RolloutReads, type RolloutRead } from '../../threads/contract/service/rolloutReads.js';
import type { RolloutStage, StagedFile } from '../../threads/journal/rolloutStaging.js';
import type { CarryAsk, Carrying, CarryOpening } from '../../threads/journal/rolloutCarry.js';
import type { FoldRow, RolloutLayer } from '../../threads/journal/rolloutMeta.js';

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
  | { readonly kind: 'stage'; readonly stage: RolloutStage }
  | { readonly kind: 'carry'; readonly carry: CarryAsk }
  | { readonly kind: 'carry-take'; readonly plan: number; readonly unit: number }
  | { readonly kind: 'layers' }
);

export type RestedTell = { readonly kind: 'carry-drop'; readonly plan: number };

export type RestedAnswer = { readonly id: number } & (
  | { readonly kind: 'transcribed'; readonly entries: number }
  | { readonly kind: 'history'; readonly history: ThreadHistory; readonly bytes: number }
  | { readonly kind: 'compaction'; readonly summary: RestedCompaction }
  | { readonly kind: 'staged'; readonly file: StagedFile }
  | { readonly kind: 'carrying'; readonly plan: number; readonly opening: CarryOpening }
  | { readonly kind: 'carried'; readonly rows: readonly FoldRow[] }
  | { readonly kind: 'layers'; readonly layers: readonly RolloutLayer[] }
  | { readonly kind: 'failed'; readonly reason: string }
);

export type RestedRead = { readonly id: number; readonly kind: 'read'; readonly reads: readonly RolloutRead[] };

const WORKER = 'rested fold worker';

const links = new Map<ThreadReaderWorker, WorkerLink<RestedAsk, RestedAnswer, RestedRead>>();

const linkOf = (start: ThreadReaderWorker): WorkerLink<RestedAsk, RestedAnswer, RestedRead> => {
  const held = links.get(start);
  if (held !== undefined) return held;
  const link = workerLink<RestedAsk, RestedAnswer, RestedRead>(WORKER, start, (message): message is RestedRead => message.kind === 'read');
  links.set(start, link);
  return link;
};

const ask = (
  kinds: ThreadEntryReader,
  rollout: RolloutFiles,
  asking: (id: number) => RestedAsk,
  span = 'ThreadTranscript.rested.fold',
): Effect.Effect<RestedAnswer, WorkerUnavailable> =>
  Effect.flatMap(RolloutReads, (read) => {
    const start = kinds.worker;
    if (start === null) return Effect.fail(workerGone(WORKER, 'its entry reader names no worker that folds with it'));
    return linkOf(start).ask(asking, [], (note) => {
      for (const one of note.reads) read(one);
    });
  }).pipe(Effect.withSpan(span, { attributes: { rollout: rollout.path } }));

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

export const stageRollout = (
  kinds: ThreadEntryReader,
  rollout: RolloutFiles,
  stage: RolloutStage,
): Effect.Effect<StagedFile, RolloutUnreadable | WorkerUnavailable> =>
  Effect.flatMap(
    ask(kinds, rollout, (id) => ({ id, rollout, kind: 'stage', stage }), 'ThreadRollout.stage'),
    (answer) => (answer.kind === 'staged' ? Effect.succeed(answer.file) : Effect.fail(unreadable(rollout, answer))),
  );

const tell = (kinds: ThreadEntryReader, message: RestedTell): Effect.Effect<void> =>
  Effect.sync(() => {
    const start = kinds.worker;
    if (start !== null) links.get(start)?.tell(message);
  });

export const carryRollout = (
  kinds: ThreadEntryReader,
  rollout: RolloutFiles,
  carry: CarryAsk,
): Effect.Effect<Carrying, RolloutUnreadable | WorkerUnavailable> =>
  Effect.flatMap(
    ask(kinds, rollout, (id) => ({ id, rollout, kind: 'carry', carry }), 'ThreadRollout.carry'),
    (answer): Effect.Effect<Carrying, RolloutUnreadable> => {
      if (answer.kind !== 'carrying') return Effect.fail(unreadable(rollout, answer));
      const { plan, opening } = answer;
      if (opening.kind !== 'planned') return Effect.succeed(opening);
      return Effect.succeed({
        ...opening,
        take: (unit: number) =>
          ask(kinds, rollout, (id) => ({ id, rollout, kind: 'carry-take', plan, unit }), 'ThreadRollout.carry.take').pipe(
            Effect.mapError((gone) => new RolloutUnreadable({ reason: 'io', path: rollout.path, message: gone.message })),
            Effect.flatMap((taken) => (taken.kind === 'carried' ? Effect.succeed(taken.rows) : Effect.fail(unreadable(rollout, taken)))),
          ),
        drop: tell(kinds, { kind: 'carry-drop', plan }),
      });
    },
  );

export const readRolloutLayers = (
  kinds: ThreadEntryReader,
  rollout: RolloutFiles,
): Effect.Effect<readonly RolloutLayer[], RolloutUnreadable | WorkerUnavailable> =>
  Effect.flatMap(
    ask(kinds, rollout, (id) => ({ id, rollout, kind: 'layers' }), 'ThreadRollout.layers'),
    (answer) => (answer.kind === 'layers' ? Effect.succeed(answer.layers) : Effect.fail(unreadable(rollout, answer))),
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
