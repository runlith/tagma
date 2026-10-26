import { Duration, Effect } from 'effect';
import type { Runner } from './Runner.js';
import {
  declineThreadOpen,
  recordThreadOpen,
  type ThreadOpenDecline,
  type ThreadOpenStage,
  type ThreadOpenTiming,
} from './threadOpenRecord.js';

let hostSequence = 0;

const DEADLINE_MS = 10_000;

export type HarnessOpenStage = 'record' | 'engine' | 'attach' | 'replay' | 'paint';

export type ThreadOpenAttempt = {
  readonly kind: 'chat';
  threadId: string;
  selectedAt: number;
  subscribedAt: number | null;
  snapshotAt: number | null;
  appliedAt: number | null;
  entries: number;
  replayed: boolean;
  subscribing: boolean;
  cancelFrame: (() => void) | null;
  cancelDeadline: (() => void) | null;
};

export type HarnessOpenAttempt = {
  readonly kind: 'harness';
  readonly threadId: string;
  readonly selectedAt: number;
  recordAt: number | null;
  engineAt: number | null;
  attachAt: number | null;
  replayAt: number | null;
  paintAt: number | null;
  reached: (stage: HarnessOpenStage, at: number) => void;
  cancelFrame: (() => void) | null;
  cancelDeadline: (() => void) | null;
};

export class ThreadOpenWatch {
  private attempt: ThreadOpenAttempt | HarnessOpenAttempt | null = null;
  private readonly host: number;

  constructor(
    private readonly runner: Runner,
    private readonly showing: (threadId: string) => boolean,
  ) {
    hostSequence += 1;
    this.host = hostSequence;
  }

  private now(): number {
    return Number(this.runner.clock.monotonicTimeNanosUnsafe()) / 1_000_000;
  }

  private timer(step: () => void, ms: number): () => void {
    return this.later(Effect.sleep(Duration.millis(ms)), step);
  }

  private frame(step: () => void): () => void {
    return this.later(nextFrame, step);
  }

  private later(wait: Effect.Effect<void>, step: () => void): () => void {
    return this.runner.start(Effect.andThen(wait, Effect.sync(step)));
  }

  get inFlight(): ThreadOpenAttempt | null {
    return this.attempt?.kind === 'chat' ? this.attempt : null;
  }

  get harness(): HarnessOpenAttempt | null {
    return this.attempt?.kind === 'harness' ? this.attempt : null;
  }

  select(threadId: string | null, kind: 'chat' | 'harness' = 'chat'): void {
    this.abandon('reselect');
    if (threadId === null) return;
    const selectedAt = this.now();
    if (kind === 'harness') {
      this.openHarness(threadId, selectedAt);
      return;
    }
    const attempt: ThreadOpenAttempt = {
      kind: 'chat',
      threadId,
      selectedAt,
      subscribedAt: null,
      snapshotAt: null,
      appliedAt: null,
      entries: 0,
      replayed: false,
      subscribing: false,
      cancelFrame: null,
      cancelDeadline: null,
    };
    this.attempt = attempt;
    attempt.cancelDeadline = this.timer(() => this.cut(attempt), DEADLINE_MS);
  }

  toHarness(): HarnessOpenAttempt | null {
    const chat = this.inFlight;
    if (chat === null) return this.harness;
    this.release(chat);
    return this.openHarness(chat.threadId, chat.selectedAt);
  }

  private openHarness(threadId: string, selectedAt: number): HarnessOpenAttempt {
    const harness: HarnessOpenAttempt = {
      kind: 'harness',
      threadId,
      selectedAt,
      recordAt: null,
      engineAt: null,
      attachAt: null,
      replayAt: null,
      paintAt: null,
      reached: () => undefined,
      cancelFrame: null,
      cancelDeadline: null,
    };
    harness.reached = (stage, at) => this.stage(harness, stage, at);
    this.attempt = harness;
    harness.cancelDeadline = this.timer(() => this.cut(harness), DEADLINE_MS);
    return harness;
  }

  standing(): void {
    declineThreadOpen('standing');
  }

  subscribing<T>(subscribe: () => T): T {
    const attempt = this.attempt?.kind === 'chat' ? this.attempt : null;
    if (attempt === null) return subscribe();
    attempt.subscribedAt = this.now();
    attempt.subscribing = true;
    try {
      return subscribe();
    } finally {
      attempt.subscribing = false;
    }
  }

  arrived(attempt: ThreadOpenAttempt | null): ThreadOpenAttempt | null {
    if (attempt === null || this.attempt !== attempt || attempt.snapshotAt !== null) return null;
    attempt.snapshotAt = this.now();
    attempt.replayed = attempt.subscribing;
    return attempt;
  }

  applied(attempt: ThreadOpenAttempt, entries: number): void {
    attempt.appliedAt = this.now();
    attempt.entries = entries;
    if (document.hidden) return this.abandon('hidden');
    attempt.cancelFrame = this.frame(() => this.complete(attempt));
  }

  abandon(reason: ThreadOpenDecline): void {
    const attempt = this.attempt;
    if (attempt === null) return;
    this.release(attempt);
    declineThreadOpen(reason);
  }

  private complete(attempt: ThreadOpenAttempt | HarnessOpenAttempt): void {
    attempt.cancelFrame = null;
    if (this.attempt !== attempt) return;
    this.release(attempt);
    if (!this.showing(attempt.threadId)) return declineThreadOpen('stale');
    if (document.hidden) return declineThreadOpen('hidden');
    this.write(attempt, 'frame', this.now());
  }

  private stage(attempt: HarnessOpenAttempt, stage: HarnessOpenStage, at: number): void {
    if (this.attempt !== attempt) return;
    if (stage === 'record') attempt.recordAt ??= at;
    else if (stage === 'engine') attempt.engineAt ??= at;
    else if (stage === 'attach') attempt.attachAt ??= at;
    else if (stage === 'replay') attempt.replayAt ??= at;
    else {
      attempt.paintAt ??= at;
      if (document.hidden) return this.abandon('hidden');
      attempt.cancelFrame = this.frame(() => this.complete(attempt));
    }
  }

  private cut(attempt: ThreadOpenAttempt | HarnessOpenAttempt): void {
    attempt.cancelDeadline = null;
    if (this.attempt !== attempt) return;
    this.release(attempt);
    this.write(attempt, attempt.kind === 'chat' ? stageOf(attempt) : null, this.now());
  }

  private write(attempt: ThreadOpenAttempt | HarnessOpenAttempt, reached: ThreadOpenStage | null, endedAt: number): void {
    const detail: ThreadOpenTiming =
      attempt.kind === 'chat'
        ? {
            kind: 'chat',
            host: this.host,
            threadId: attempt.threadId,
            entries: attempt.entries,
            replayed: attempt.replayed,
            reached: reached ?? stageOf(attempt),
            selectToSubscribeMs: span(attempt.selectedAt, attempt.subscribedAt),
            subscribeWaitMs: span(attempt.subscribedAt, attempt.snapshotAt),
            applyMs: span(attempt.snapshotAt, attempt.appliedAt),
            applyToFrameMs: reached === 'frame' ? span(attempt.appliedAt, endedAt) : null,
            totalMs: endedAt - attempt.selectedAt,
          }
        : {
            kind: 'harness',
            host: this.host,
            threadId: attempt.threadId,
            recordMs: span(attempt.selectedAt, attempt.recordAt),
            engineMs: span(attempt.recordAt, attempt.engineAt),
            attachMs: span(attempt.engineAt, attempt.attachAt),
            replayMs: span(attempt.attachAt, attempt.replayAt),
            paintMs: span(attempt.replayAt, attempt.paintAt),
            totalMs: endedAt - attempt.selectedAt,
          };
    recordThreadOpen(detail, attempt.selectedAt);
  }

  private release(attempt: ThreadOpenAttempt | HarnessOpenAttempt): void {
    this.attempt = null;
    attempt.cancelFrame?.();
    attempt.cancelDeadline?.();
    attempt.cancelFrame = null;
    attempt.cancelDeadline = null;
  }
}

const nextFrame = Effect.callback<void>((resume) => {
  const id = requestAnimationFrame(() => resume(Effect.void));
  return Effect.sync(() => cancelAnimationFrame(id));
});

function stageOf(attempt: ThreadOpenAttempt): ThreadOpenStage {
  if (attempt.appliedAt !== null) return 'apply';
  if (attempt.subscribedAt !== null) return 'subscribe';
  return 'select';
}

function span(from: number | null, to: number | null): number | null {
  return from === null || to === null ? null : to - from;
}
