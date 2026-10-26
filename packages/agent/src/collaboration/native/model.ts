import { Effect, Layer } from 'effect';
import { actDigest, callKey, type Keyed } from '../../thread/keyed';
import { ThreadModels } from '../../thread/run/ThreadModels';
import { ThreadSnapshots } from '../../thread/run/ThreadSnapshots';
import { ThreadNotFoundError } from '../../thread/storage/aggregate';
import { ThreadStorageFailed } from '../../thread/persisted';
import { type ThreadBorderFailed, ThreadCallBroke, ThreadMissing, storageFailed } from '../../thread/ThreadBorder';
import { ThreadModelMoves, ThreadStore } from '../../thread/ThreadPorts';
import { ThreadActReusedError } from '../../thread/transition/port';
import { DeclaredCollaboration } from '../CollaborationConfig';
import {
  ThreadModel,
  ThreadModelConflict,
  type ThreadModelFailure,
  ThreadModelLost,
  ThreadModelRefused,
  ThreadModelUnavailable,
} from '../model';
import { keptSwitches } from '@runlith/llm/models/description';
import { modelOf } from './modelChoice';
export const makeNativeThreadModel = Effect.gen(function* () {
  const moves = yield* ThreadModelMoves;
  const declared = yield* DeclaredCollaboration;
  const models = yield* ThreadModels;
  const snapshots = yield* ThreadSnapshots;
  const store = yield* ThreadStore;
  return ThreadModel.of({
    adapted: Effect.fn('ThreadModel.adapted')(
      function* (threadId, input, act) {
        const option = input.option;
        const to = { provider: option.provider, model: option.id, reasoning: input.reasoning };
        const key: Keyed = {
          evidence: { call: callKey({ operation: 'move', actor: threadId, key: input.request.key }) },
          digest: actDigest({ ...to, switches: option.switches }),
        };
        const thread = yield* store.metadata(threadId);
        if (thread === undefined) return yield* new ThreadMissing({ threadId });
        const outcome = yield* models.adapted(
          thread,
          key,
          Effect.map(act, (moved) =>
            moved === null
              ? null
              : {
                  from: moved.from ?? { provider: moved.to.provider, model: 'default', reasoning: null },
                  to: moved.to,
                  resume: input.resume,
                },
          ),
        );
        if ('spent' in outcome) return { status: 'spent' as const, at: outcome.spent.at };
        if ('stalled' in outcome || 'refused' in outcome) return yield* new ThreadModelUnavailable({ threadId, reason: 'deadline' });
        const moved = 'committed' in outcome ? outcome.committed : outcome.replayed;
        if (moved === null) return null;
        return {
          status: 'moved' as const,
          from: { ...moved.from, model: moved.from.model ?? 'default' },
          to: { ...moved.to, model: moved.to.model ?? option.id },
          acted: 'committed' in outcome,
          resume: moved.resume,
        };
      },
      (effect, threadId, input, act) =>
        effect.pipe(
          Effect.catch((failure): Effect.Effect<never, ThreadModelFailure> => {
            if (failure instanceof ThreadActReusedError) {
              return Effect.fail(new ThreadModelConflict({ threadId, reason: 'act-id-reused', key: input.request.key }));
            }
            if (failure instanceof ThreadNotFoundError) return Effect.fail(new ThreadMissing({ threadId }));
            if (
              failure instanceof ThreadMissing ||
              failure instanceof ThreadModelRefused ||
              failure instanceof ThreadModelConflict ||
              failure instanceof ThreadModelUnavailable ||
              failure instanceof ThreadModelLost ||
              failure instanceof ThreadStorageFailed ||
              failure instanceof ThreadCallBroke
            ) {
              return Effect.fail(failure);
            }
            return Effect.fail(storageFailed('model.adapted')(failure as ThreadBorderFailed));
          }),
        ),
    ),
    move: Effect.fn('ThreadModel.move')(
      function* (threadId, input) {
        const option = input.option;
        const to = { provider: option.provider, model: option.id, reasoning: input.reasoning };
        const key: Keyed = {
          evidence: { call: callKey({ operation: 'move', actor: threadId, key: input.request.key }) },
          digest: actDigest({ ...to, switches: option.switches }),
        };
        const thread = yield* store.metadata(threadId);
        if (thread === undefined) return yield* new ThreadMissing({ threadId });
        const outcome = yield* models.move(
          thread,
          key,
          (child) => ({
            account: option.provider !== child.provider ? null : child.account,
            provider: option.provider,
            model: option.id,
            reasoning: input.reasoning,
            switches: keptSwitches(option.switches, child.switches),
          }),
          input.resume,
        );
        if ('spent' in outcome) return { status: 'spent' as const, at: outcome.spent.at };
        if ('refused' in outcome) return yield* new ThreadModelRefused({ threadId, reason: 'thread-running' });
        if ('stalled' in outcome) return yield* new ThreadModelUnavailable({ threadId, reason: 'deadline' });
        const moved = 'committed' in outcome ? outcome.committed : outcome.replayed;
        if (moved === null) return yield* new ThreadModelRefused({ threadId, reason: 'thread-running' });
        if ('committed' in outcome) {
          const row = yield* store.find(threadId);
          if (row && moves !== null) yield* moves.moved(row);
          yield* snapshots.publish(threadId);
          if (row?.parentThreadId) yield* snapshots.publish(row.parentThreadId);
        }
        const from = { ...moved.from, model: modelOf(declared?.models() ?? null, moved.from) ?? option.id };
        return { status: 'moved' as const, from, to, acted: 'committed' in outcome, resume: moved.resume };
      },
      (effect, threadId, input) =>
        effect.pipe(
          Effect.catch((failure): Effect.Effect<never, ThreadModelFailure> => {
            if (failure instanceof ThreadMissing || failure instanceof ThreadModelRefused || failure instanceof ThreadModelUnavailable) {
              return Effect.fail(failure);
            }
            if (failure instanceof ThreadActReusedError) {
              return Effect.fail(new ThreadModelConflict({ threadId, reason: 'act-id-reused', key: input.request.key }));
            }
            if (failure instanceof ThreadNotFoundError) return Effect.fail(new ThreadMissing({ threadId }));
            return Effect.fail(storageFailed('model.move')(failure));
          }),
        ),
    ),
  });
});

export const nativeThreadModelLayer = Layer.effect(ThreadModel, makeNativeThreadModel);
