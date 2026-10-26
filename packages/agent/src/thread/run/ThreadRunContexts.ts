import { coreEntry } from '../../transcript/kinds';
import { Clock, Data, Context, Effect, Layer } from 'effect';
import { note } from '@runlith/activity/Activity';
import type { RunNote } from './notes';
import type { ThreadContextChangeEntry } from '../../transcript/entries';
import { actDigest } from '../keyed';
import { transitionDeps, transitionNow } from '../transition/kernel';
import type { Decision } from '../transition/port';
import { readThreadContextEvidence, threadContextChangeEvent, threadContextOf, threadPendingContextChange } from '../events';
import type { ThreadContextChange, ThreadContextEvidence, ThreadContextRecord } from '../rows';
import { ThreadOwner, type ThreadTx, type ThreadWriteTx } from '../ThreadPorts';
import { ThreadCallBroke, type ThreadBorderFailed, type ThreadPortFailure } from '../ThreadBorder';
import { ThreadRunLedger, type ThreadRunRef } from './ThreadRunLedger';
import { ThreadRunSettlements } from './ThreadRunSettlements';
export type ThreadContextAsk<TWrite = ThreadWriteTx> = {
  readonly requestId: string;
  readonly sourceKey: string;
  readonly commit?: (tx: TWrite) => Effect.Effect<void, ThreadBorderFailed>;
};
export type ThreadContextAnswer =
  | {
      readonly status: 'accepted' | 'pending';
      readonly requestId: string;
      readonly fromGeneration: number;
    }
  | {
      readonly status: 'published';
      readonly requestId: string;
      readonly generation: number;
    }
  | {
      readonly status: 'denied';
      readonly requestId: string;
      readonly detail: string;
    };
export class ThreadContextConflictError extends Data.TaggedError('ThreadContextConflict')<{
  readonly message: string;
  readonly threadId: string;
  readonly runId: string;
  readonly requestId: string;
}> {
  constructor(input: { threadId: string; runId: string; requestId: string; reason: string }) {
    super({ message: input.reason, threadId: input.threadId, runId: input.runId, requestId: input.requestId });
    this.name = 'ThreadContextConflictError';
  }
}
export type ThreadContextPublication = {
  readonly stepNumber: number;
  readonly evidence: ThreadContextEvidence;
  readonly halted: () => boolean;
};

export class ThreadRunContexts extends Context.Service<
  ThreadRunContexts,
  {
    request(run: ThreadRunRef, ask: ThreadContextAsk): Effect.Effect<ThreadContextAnswer, ThreadBorderFailed>;
    read(run: ThreadRunRef): Effect.Effect<ThreadContextState, ThreadBorderFailed>;
    holds(runId: string): boolean;
    publish(change: ThreadContextStanding, admitted: ThreadContextPublication): Effect.Effect<boolean, ThreadBorderFailed>;
    deny(change: ThreadContextStanding, cause: unknown): Effect.Effect<void, ThreadBorderFailed>;
    close(run: ThreadRunRef): Effect.Effect<void, ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadRunContexts') {}
export type ThreadContextState = {
  readonly admitted: ThreadContextAdmission | null;
  readonly standing: ThreadContextStanding | null;
};
export type ThreadContextAdmission = {
  readonly record: ThreadContextRecord;
  readonly evidence: ThreadContextEvidence;
};
export type ThreadContextStanding = {
  readonly threadId: string;
  readonly runId: string;
  readonly requestId: string;
  readonly sourceKey: string;
  readonly fromGeneration: number;
  readonly context: ThreadContextRecord;
  readonly held: boolean;
};
export const makeThreadRunContexts = Effect.gen(function* () {
  const kernel = yield* transitionDeps;
  const { store, log: journal, kinds } = kernel;
  const owner = yield* ThreadOwner;
  const ledger = yield* ThreadRunLedger;
  const held = new Map<string, ((tx: ThreadWriteTx) => Effect.Effect<void, ThreadBorderFailed>) | null>();
  const key = (runId: string, requestId: string) => `${runId}\u0000${requestId}`;
  const reconcile = (): Effect.Effect<void, never> =>
    Effect.suspend(() => {
      const runs = [...new Set([...held.keys()].map((entry) => entry.slice(0, entry.indexOf('\u0000'))))];
      if (runs.length === 0) return Effect.void;
      return ledger.runningHere(runs).pipe(
        Effect.map((running) => {
          const ours = new Set(running);
          for (const entry of [...held.keys()]) {
            if (!ours.has(entry.slice(0, entry.indexOf('\u0000')))) held.delete(entry);
          }
        }),
        Effect.tapError((failure) => Effect.logWarning('Run context cleanup could not read active runs; held requests remain', failure)),
        Effect.ignore,
      );
    });
  const evidenceOf = Effect.fnUntraced(function* (
    run: ThreadRunRef,
    record: ThreadContextRecord,
  ): Effect.fn.Return<ThreadContextEvidence, ThreadBorderFailed> {
    const change = yield* readThreadContextEvidence(journal, kinds, {
      threadId: run.threadId,
      runId: run.id,
      requestId: record.requestId,
    });
    const evidence = change?.evidence;
    if (!evidence) {
      return yield* new ThreadCallBroke({
        cause: new Error(
          `Run ${run.id} of thread ${run.threadId} records generation ${record.generation} under request ${record.requestId} with no evidence of what it was admitted with.`,
        ),
      });
    }
    return evidence;
  });
  const refuse = (threadId: string, runId: string, requestId: string, reason: string): Effect.Effect<never, ThreadBorderFailed> =>
    new ThreadCallBroke({ cause: new ThreadContextConflictError({ threadId, runId, requestId, reason }) });
  const drives = (runId: string, threadId: string, tx: ThreadTx): Effect.Effect<boolean, ThreadPortFailure> =>
    Effect.map(ledger.latestRun(threadId, ['running'], tx), (active) => active?.id === runId && active.ownerId === owner.id);
  const answerOf = (entry: ThreadContextChangeEntry): ThreadContextAnswer =>
    entry.status === 'published' && entry.generation !== undefined
      ? { status: 'published', requestId: entry.requestId, generation: entry.generation }
      : entry.status === 'denied'
        ? { status: 'denied', requestId: entry.requestId, detail: entry.detail ?? 'The context change was refused.' }
        : { status: 'pending', requestId: entry.requestId, fromGeneration: entry.fromGeneration };
  const changeOf = (run: ThreadRunRef, entry: ThreadContextChangeEntry): ThreadContextStanding => ({
    threadId: run.threadId,
    runId: run.id,
    requestId: entry.requestId,
    sourceKey: entry.sourceKey,
    fromGeneration: entry.fromGeneration,
    context: {
      generation: entry.fromGeneration + 1,
      sourceKey: entry.sourceKey,
      requestId: entry.requestId,
    },
    held: held.has(key(run.id, entry.requestId)),
  });
  const settle = Effect.fnUntraced(function* (
    change: ThreadContextStanding,
    outcome: 'published' | 'denied',
    settled: {
      readonly evidence?: ThreadContextEvidence;
      readonly stepNumber?: number;
      readonly detail?: string;
      readonly halted?: () => boolean;
    },
  ): Effect.fn.Return<boolean, ThreadBorderFailed> {
    let wrote = false;
    let took = false;
    const refused = { refuse: undefined } as Decision<undefined, ThreadWriteTx>;
    yield* transitionNow<undefined, ThreadWriteTx>(
      kernel,
      change.threadId,
      {
        declared: [],
        decide: Effect.fnUntraced(function* (_view, tx) {
          const entries = yield* store.entriesOfRun(change.threadId, change.runId, tx);
          const standing = threadPendingContextChange(entries);
          if (!standing || standing.requestId !== change.requestId) return refused;
          const admitted = threadContextOf(entries);
          if ((admitted?.generation ?? 0) !== change.fromGeneration) return refused;
          if (settled.halted?.() === true) return refused;
          if (outcome === 'published' && !(yield* drives(change.runId, change.threadId, tx))) return refused;
          const commit = held.get(key(change.runId, change.requestId));
          const record: ThreadContextChange = {
            requestId: change.requestId,
            runId: change.runId,
            sourceKey: change.sourceKey,
            fromGeneration: change.fromGeneration,
            outcome,
            record: outcome === 'published' ? change.context : undefined,
            evidence: settled.evidence,
            stepNumber: settled.stepNumber,
            detail: settled.detail,
            requestedAt: standing.occurredAt,
            settledAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
          };
          wrote = true;
          took = outcome === 'published';
          return {
            apply: true,
            result: undefined,
            events: [threadContextChangeEvent(record)],
            participants: outcome === 'published' && commit ? (unit: ThreadWriteTx) => commit(unit) : undefined,
          } as Decision<undefined, ThreadWriteTx>;
        }),
      },
      {
        evidence: { decidedBy: `context:${change.runId}:${change.requestId}` },
        digest: actDigest(['context-settle', change.runId, change.requestId, outcome]),
      },
    ).pipe(Effect.catchTag('ThreadNotFound', () => Effect.void));
    if (wrote) held.delete(key(change.runId, change.requestId));
    yield* note<RunNote>(
      {
        type: 'context-settled',
        request: change.requestId,
        outcome: wrote ? outcome : 'refused',
        generation: change.context.generation,
      },
      { run: change.runId },
    );
    return took;
  });
  return ThreadRunContexts.of({
    request: Effect.fn('request')(function* (run, ask) {
      const decided: {
        answer: ThreadContextAnswer | null;
        conflict: string | null;
      } = {
        answer: null,
        conflict: null,
      };
      const noted = { refuse: undefined } as Decision<undefined, ThreadWriteTx>;
      const recorded = yield* transitionNow<undefined, ThreadWriteTx>(
        kernel,
        run.threadId,
        {
          declared: [],
          decide: Effect.fnUntraced(function* (_view, tx) {
            const entries = yield* store.entriesOfRun(run.threadId, run.id, tx);
            const mine = entries.find(
              (entry): entry is ThreadContextChangeEntry =>
                coreEntry(entry) && entry.type === 'context-change' && entry.requestId === ask.requestId,
            );
            if (mine) {
              if (mine.sourceKey !== ask.sourceKey) {
                decided.conflict = `Request ${ask.requestId} already names another destination for this run.`;
                return noted;
              }
              decided.answer = answerOf(mine);
              return noted;
            }
            const standing = threadPendingContextChange(entries);
            if (standing) {
              decided.conflict = `This run is already changing context under request ${standing.requestId}.`;
              return noted;
            }
            if (!(yield* drives(run.id, run.threadId, tx))) {
              decided.conflict = 'This run is not the one this instance is driving.';
              return noted;
            }
            const admitted = threadContextOf(entries);
            const change: ThreadContextChange = {
              requestId: ask.requestId,
              runId: run.id,
              sourceKey: ask.sourceKey,
              fromGeneration: admitted?.generation ?? 0,
              outcome: 'pending',
              requestedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
            };
            decided.answer = {
              status: 'accepted',
              requestId: ask.requestId,
              fromGeneration: change.fromGeneration,
            };
            return { apply: true, result: undefined, events: [threadContextChangeEvent(change)] } as Decision<undefined, ThreadWriteTx>;
          }),
        },
        {
          evidence: { decidedBy: `context:${run.id}:${ask.requestId}` },
          digest: actDigest(['context-request', run.id, ask.requestId, ask.sourceKey]),
        },
      ).pipe(
        Effect.map((outcome) => 'committed' in outcome),
        Effect.catchTag('ThreadNotFound', () => Effect.succeed(undefined)),
      );
      if (decided.conflict !== null) {
        return yield* refuse(run.threadId, run.id, ask.requestId, decided.conflict);
      }
      const given = decided.answer;
      if (given === null || (given.status === 'accepted' && recorded === undefined)) {
        return yield* refuse(run.threadId, run.id, ask.requestId, 'This thread no longer exists.');
      }
      if (given.status === 'accepted') {
        held.set(key(run.id, ask.requestId), ask.commit ?? null);
        yield* reconcile();
        yield* note<RunNote>({ type: 'context-requested', request: ask.requestId, fromGeneration: given.fromGeneration }, { run: run.id });
      }
      return given;
    }),
    read: Effect.fn('read')(function* (run) {
      const entries = yield* store.entriesOfRun(run.threadId, run.id);
      const pending = threadPendingContextChange(entries);
      const standing = pending === null ? null : changeOf(run, pending);
      const record = threadContextOf(entries);
      return record === null ? { admitted: null, standing } : { admitted: { record, evidence: yield* evidenceOf(run, record) }, standing };
    }),
    holds: (runId) => {
      const prefix = `${runId}\u0000`;
      for (const key of held.keys()) if (key.startsWith(prefix)) return true;
      return false;
    },
    publish: Effect.fn('publish')(function (change, admitted) {
      return settle(change, 'published', {
        evidence: admitted.evidence,
        stepNumber: admitted.stepNumber,
        halted: admitted.halted,
      });
    }),
    deny: Effect.fn('deny')(function (change, cause) {
      return Effect.asVoid(settle(change, 'denied', { detail: cause instanceof Error ? cause.message : String(cause) }));
    }),
    close: Effect.fn('close')(function* (run) {
      const prefix = `${run.id}\u0000`;
      const release = () => {
        for (const entry of [...held.keys()]) if (entry.startsWith(prefix)) held.delete(entry);
      };
      if (![...held.keys()].some((entry) => entry.startsWith(prefix))) return;
      const standing = yield* Effect.map(store.entriesOfRun(run.threadId, run.id), (entries) => {
        const pending = threadPendingContextChange(entries);
        return pending === null ? null : changeOf(run, pending);
      });
      if (standing === null || !standing.held) {
        release();
        return;
      }
      yield* Effect.asVoid(
        settle(standing, 'denied', {
          detail: 'The run this change was asked of ended before it reached another step boundary.',
        }),
      );
    }),
  });
});

export const threadRunContextsLayer = Layer.effect(ThreadRunContexts, makeThreadRunContexts);

export const threadRunContextsClosingLayer: Layer.Layer<never, never, ThreadRunContexts | ThreadRunSettlements> = Layer.effectDiscard(
  Effect.gen(function* () {
    const contexts = yield* ThreadRunContexts;
    yield* (yield* ThreadRunSettlements).subscribe({
      name: 'run context close',
      handle: (event) => contexts.close({ id: event.runId, threadId: event.threadId }),
    });
  }),
);
