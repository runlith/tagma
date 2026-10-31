import { Data, type Effect } from 'effect';
import type { ThreadCompactionEntry, ThreadInteractionAnswer, ThreadQuestionEntry } from '../../transcript/entries';
import type { WordsWait } from '../../transcript/live';
import type { ThreadRunStoppedBy } from '../ending';
import type { AgentRuntimeGuidance } from '../../agent/contracts';
import type { ThreadEventBody } from '../events';
import type { ThreadForkCut, TransportBinding, TransportCapabilities } from '../record';
import type { ThreadTx, ThreadWriteTx } from '../ThreadPorts';
import type { ThreadRow, ThreadRunRow } from '../rows';
import type { ThreadInboxItem } from '../storage/inbox';
import type { HostedResume, ThreadAbandonedRun } from '../storage/runs';
import type { ThreadBorderFailed, ThreadPortFailure } from '../ThreadBorder';

export class LaunchFailed extends Data.TaggedError('LaunchFailed')<{ readonly reason: string }> {}

export class WithdrawFailed extends Data.TaggedError('WithdrawFailed')<{ readonly reason: string }> {}

export type GuidanceNote = { readonly text: string; readonly frame: AgentRuntimeGuidance };

export type PromptGuidance = {
  readonly texts: readonly string[];
  readonly tail: GuidanceNote | null;
  readonly events: readonly ThreadEventBody[];
  readonly delivered: Effect.Effect<void>;
};

export type GuidedWords = { readonly projectId: number; readonly inputs: readonly string[] };

export type GuidanceOrientation = {
  readonly texts: readonly string[];
  readonly law: unknown;
};

export type GuidanceLaw = {
  readonly text: string;
  readonly law: unknown;
};

export type GuidanceTail = {
  readonly text: string;
  readonly ruleId: string;
  readonly state: Readonly<Record<string, unknown>>;
};

export type GuidanceSources = {
  orientation(thread: ThreadRow): Effect.Effect<GuidanceOrientation, ThreadBorderFailed>;
  law(thread: ThreadRow, delivered: unknown): Effect.Effect<GuidanceLaw, ThreadBorderFailed>;
  recap(thread: ThreadRow): Effect.Effect<string | null, ThreadBorderFailed>;
  tail(threadId: string, words: GuidedWords): Effect.Effect<GuidanceTail | null, ThreadBorderFailed>;
};

export type LaunchGuidance = {
  prompt(
    thread: ThreadRow,
    run: ThreadRunRow,
    words: GuidedWords,
    sources: GuidanceSources,
  ): Effect.Effect<PromptGuidance, ThreadBorderFailed>;
  notes(
    threadId: string,
    runId: string,
    words: GuidedWords,
    sources: GuidanceSources,
  ): Effect.Effect<GuidanceNote | null, ThreadBorderFailed>;
  reset(threadId: string, recap: boolean): void;
};

export type RunLaunch = {
  readonly thread: ThreadRow;
  readonly run: ThreadRunRow;
  readonly oriented: boolean;
  readonly outputOptional: boolean;
  readonly seed: readonly ThreadInboxItem[];
  readonly guidance: LaunchGuidance;
};

export type RunMark = { readonly callId: string } | 'all';

export type Withdrawal = 'withdrawn' | 'taken' | 'unsent';

export type InterruptReceipt = 'interrupted' | 'no-turn';

export type TransportRuns = {
  launch(launch: RunLaunch): Effect.Effect<void, LaunchFailed>;
  deliver(run: ThreadRunRow, items: readonly ThreadInboxItem[]): Effect.Effect<void, ThreadBorderFailed>;
  withdraw(run: ThreadRunRow, item: ThreadInboxItem): Effect.Effect<Withdrawal, WithdrawFailed>;
  queued(run: ThreadRunRow): Effect.Effect<void, ThreadBorderFailed>;
  holds(runIds: readonly string[]): readonly string[];
  interrupt(runId: string, by: ThreadRunStoppedBy | null): Effect.Effect<InterruptReceipt, ThreadPortFailure>;
  adopt(candidate: ThreadAbandonedRun): Effect.Effect<HostedResume, ThreadBorderFailed>;
  reached(run: ThreadRunRow, mark: RunMark): Effect.Effect<void, ThreadPortFailure>;
  handed?(run: ThreadRunRow): Effect.Effect<readonly ThreadInboxItem[], ThreadPortFailure>;
  wordsWait?(threadId: string): WordsWait | null;
};

export type AskDelivery = 'delivered' | 'unwritten' | 'gone' | 'unknown';

export type TransportAsks = {
  answer(
    threadId: string,
    question: ThreadQuestionEntry,
    answers: readonly ThreadInteractionAnswer[],
  ): Effect.Effect<AskDelivery, ThreadBorderFailed>;
};

export type JournalRuns = {
  cut(threadId: string, tx?: ThreadTx): Effect.Effect<readonly string[], ThreadPortFailure>;
  kept(threadId: string, tx?: ThreadTx): Effect.Effect<readonly string[], ThreadPortFailure>;
  rewound(threadId: string, tx?: ThreadTx): Effect.Effect<readonly string[], ThreadPortFailure>;
};

export type TransportHistory = {
  restore(threadId: string, runIds: readonly string[]): Effect.Effect<void, ThreadBorderFailed>;
  reset(threadId: string): Effect.Effect<void, ThreadBorderFailed>;
  fork(
    source: string,
    child: string,
    cut: ThreadForkCut,
    account: string | null,
    tx: ThreadWriteTx,
  ): Effect.Effect<void, ThreadBorderFailed>;
  moved(threadId: string): Effect.Effect<void, ThreadBorderFailed>;
};

export type TransportCompaction = {
  compact(run: ThreadRunRow, keep: string | undefined, mode?: ThreadCompactionEntry['mode']): Effect.Effect<void, ThreadBorderFailed>;
};

export type TransportResource = {
  release(threadId: string, operation?: string): Effect.Effect<'stopped' | 'not-running', ThreadBorderFailed>;
  seated(threadId: string): Effect.Effect<void, ThreadBorderFailed>;
  watch(): Effect.Effect<void, ThreadBorderFailed>;
};

export type TransportDeclaration = {
  readonly history: TransportCapabilities['history'];
  readonly compaction: TransportCapabilities['compaction'];
};

export type Transport = {
  readonly adapter: string;
  readonly declares: TransportDeclaration;
  readonly words: 'opening' | 'receipt';
  readonly runs: TransportRuns;
  readonly asks?: TransportAsks;
  readonly history?: TransportHistory;
  readonly compaction?: TransportCompaction;
  readonly resource?: TransportResource;
};

export class TransportMismatch extends Data.TaggedError('TransportMismatch')<{
  readonly adapter: string;
  readonly capability: string;
  readonly subject: string;
  readonly declared: boolean;
}> {
  override get message(): string {
    return this.declared
      ? `Transport ${this.adapter} declares ${this.capability} but registers no ${this.subject}.`
      : `Transport ${this.adapter} registers ${this.subject} but does not declare ${this.capability}.`;
  }
}

export class TransportRegistered extends Data.TaggedError('TransportRegistered')<{ readonly adapter: string }> {
  override get message(): string {
    return `A transport is already registered as ${this.adapter}.`;
  }
}

export class TransportUnregistered extends Data.TaggedError('TransportUnregistered')<{ readonly adapter: string }> {
  override get message(): string {
    return `No transport is registered as ${this.adapter}.`;
  }
}

export type TransportRegistry = {
  register(transport: Transport): Effect.Effect<void, TransportMismatch | TransportRegistered>;
  of(binding: TransportBinding): Effect.Effect<Transport, TransportUnregistered>;
  all(): readonly Transport[];
};
