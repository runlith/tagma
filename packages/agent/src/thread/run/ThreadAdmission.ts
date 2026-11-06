import { Context, Deferred, Effect, Exit, Layer } from 'effect';
import type { ThreadAttachmentRef } from '../../transcript/attachments';
import { mintThreadSignalId } from '../identity';
import {
  actDigest,
  evidenceKey,
  inputEvidence,
  inputItemId,
  type AdmitCaller,
  type Evidence,
  type Keyed,
  type ThreadInputOptions,
} from '../keyed';
import { ThreadCallBroke, threadCauseOf, type ThreadBorderFailed } from '../ThreadBorder';
import { ThreadBudgetSpentError, ThreadStore, ThreadTransitions } from '../ThreadPorts';
import type { ThreadMetadataRow } from '../rows';
import { ThreadStorageFailed } from '../persisted';
import { ThreadActReusedError, ThreadActSpentError } from '../transition/port';
import { ThreadAggregate } from './ThreadAggregate';
import { decodeRecord, isRefusal, refusalFailure, type BudgetRefusal, type KeyedAnswer, type KeyedRecord } from './scheduler/answers';
import type { ThreadSaid, ThreadSteerInput } from './scheduler/inputs';

export type RunReceipt = {
  readonly status: 'delivered' | 'queued' | 'woken' | 'stored';
  readonly runId: string | null;
  readonly acted: boolean;
};

export type AdmitItem = {
  readonly kind: 'say';
  readonly mode: 'send' | 'queue';
  readonly text: string;
  readonly attachments?: readonly ThreadAttachmentRef[];
};

export type Kept<A> = { readonly answer: A; readonly acted: boolean };

const READER: AdmitCaller = { kind: 'reader' };

function refusalOf(failure: ThreadBorderFailed): BudgetRefusal | null {
  const cause = threadCauseOf(failure);
  return cause instanceof ThreadBudgetSpentError ? { refused: { budgetSpent: cause.allowed } } : null;
}

export function receiptOf(said: ThreadSaid): RunReceipt {
  const acted = said.replayed !== true;
  switch (said.status) {
    case 'started':
      return { status: 'woken', runId: said.runId, acted };
    case 'steered':
      return { status: 'delivered', runId: said.runId, acted };
    case 'queued':
      return { status: 'queued', runId: said.runId, acted };
  }
}

export class ThreadAdmission extends Context.Service<
  ThreadAdmission,
  {
    say(threadId: string, ownerId: string, item: AdmitItem, options: ThreadInputOptions): Effect.Effect<ThreadSaid, ThreadBorderFailed>;
    steer(
      threadId: string,
      ownerId: string,
      input: ThreadSteerInput,
      options: ThreadInputOptions,
    ): Effect.Effect<ThreadSaid, ThreadBorderFailed>;
    admit(
      threadId: string,
      ownerId: string,
      item: AdmitItem,
      caller: AdmitCaller,
      key: string,
    ): Effect.Effect<RunReceipt, ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadAdmission') {}

export const threadAdmissionLayer: Layer.Layer<ThreadAdmission, never, ThreadAggregate | ThreadStore | ThreadTransitions> = Layer.effect(
  ThreadAdmission,
  Effect.gen(function* () {
    const aggregate = yield* ThreadAggregate;
    const store = yield* ThreadStore;
    const transitions = yield* ThreadTransitions;
    const flying = new Map<string, { readonly digest: string; readonly done: Deferred.Deferred<KeyedAnswer, ThreadBorderFailed> }>();

    const once = (
      threadId: string,
      evidence: Evidence,
      digest: string,
      road: (admitted: Keyed) => Effect.Effect<KeyedAnswer, ThreadBorderFailed>,
    ): Effect.Effect<Kept<KeyedAnswer>, ThreadBorderFailed> =>
      Effect.suspend(() => {
        const name = JSON.stringify([threadId, evidenceKey(evidence)]);
        const standing = flying.get(name);
        if (standing !== undefined) {
          return standing.digest === digest
            ? Effect.map(Deferred.await(standing.done), (answer) => ({ answer, acted: false }))
            : Effect.fail(new ThreadActReusedError({ threadId, evidence }));
        }
        const done = Deferred.makeUnsafe<KeyedAnswer, ThreadBorderFailed>();
        flying.set(name, { digest, done });
        const run = Effect.gen(function* () {
          const reading = yield* transitions.readRecord(threadId, evidence);
          switch (reading.kind) {
            case 'present': {
              if (reading.digest !== digest) return yield* Effect.fail(new ThreadActReusedError({ threadId, evidence }));
              const record = decodeRecord(reading.result);
              if (record === null) {
                return yield* new ThreadStorageFailed({
                  call: 'admission',
                  cause: new Error(`Thread ${threadId}: the record under this key holds no answer an admission can replay.`),
                });
              }
              if (isRefusal(record)) return yield* refusalFailure(record);
              return { answer: record, acted: false };
            }
            case 'spent':
              if (reading.digest !== digest) return yield* Effect.fail(new ThreadActReusedError({ threadId, evidence }));
              return yield* Effect.fail(new ThreadActSpentError({ threadId, at: reading.at }));
            case 'before-epoch':
              return yield* Effect.fail(new ThreadActSpentError({ threadId, at: 'before-epoch' }));
            case 'standing':
              if (reading.digest !== digest) return yield* Effect.fail(new ThreadActReusedError({ threadId, evidence }));
              break;
            case 'absent':
            case 'decided':
              break;
          }
          const keep = (result: KeyedRecord) =>
            store.transaction((tx) =>
              Effect.flatMap(transitions.readRecord(threadId, evidence, tx), (written) =>
                written.kind === 'present' ? Effect.void : transitions.writeRecord(threadId, evidence, { digest, result }, tx),
              ),
            );
          const answer = yield* road({ evidence, digest }).pipe(
            Effect.tapError((failure) => {
              const refused = refusalOf(failure);
              return refused === null ? Effect.void : keep(refused);
            }),
          );
          return { answer, acted: true };
        });
        return run.pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              flying.delete(name);
              Deferred.doneUnsafe(
                done,
                Exit.map(exit, (kept) => kept.answer),
              );
            }),
          ),
        );
      });

    const ownedOnce = Effect.fnUntraced(function* (
      threadId: string,
      ownerId: string,
      caller: AdmitCaller,
      key: string,
      digest: string,
      road: (thread: ThreadMetadataRow, admitted: Keyed) => Effect.Effect<KeyedAnswer, ThreadBorderFailed>,
    ): Effect.fn.Return<ThreadSaid, ThreadBorderFailed> {
      const thread = yield* store.metadata(threadId);
      if (!thread || thread.ownerId !== ownerId) return yield* new ThreadCallBroke({ cause: new Error(`Thread not found: ${threadId}.`) });
      const kept = yield* once(threadId, inputEvidence(caller, key), digest, (admitted) => road(thread, admitted));
      return kept.acted ? kept.answer : { ...kept.answer, replayed: true };
    });

    const say: Context.Service.Shape<typeof ThreadAdmission>['say'] = (threadId, ownerId, item, options) => {
      const caller = options.caller ?? READER;
      const key = options.key ?? mintThreadSignalId();
      const digest = actDigest(['say', threadId, item.mode, item.text.trim(), (item.attachments ?? []).map((ref) => ref.id)]);
      const road = (thread: ThreadMetadataRow, admitted: Keyed) => {
        const sender =
          caller.kind === 'external'
            ? ({ kind: 'external', name: caller.name, ...(caller.title === undefined ? {} : { title: caller.title }) } as const)
            : undefined;
        const options_ = { key, inputId: inputItemId(caller, key), admitted, sender };
        return item.mode === 'send'
          ? aggregate.send(thread, item.text, item.attachments, options_)
          : aggregate.queue(thread, item.text, item.attachments, options_);
      };
      return ownedOnce(threadId, ownerId, caller, key, digest, road);
    };

    return {
      say,
      steer: (threadId, ownerId, input, options) => {
        const caller = options.caller ?? READER;
        const key = options.key ?? mintThreadSignalId();
        const digest = actDigest([
          'steer',
          threadId,
          input.expectedRunId,
          input.text.trim(),
          (input.attachments ?? []).map((ref) => ref.id),
        ]);
        return ownedOnce(threadId, ownerId, caller, key, digest, (thread, admitted) =>
          aggregate.steer(thread, { ...input, id: inputItemId(caller, key) }, admitted),
        );
      },
      admit: (threadId, ownerId, item, caller, key) => Effect.map(say(threadId, ownerId, item, { caller, key }), receiptOf),
    };
  }),
);
