import type { AgentAside } from '@runlith/agent/AgentAside';
import { ActivityLog } from '@runlith/activity/log';
import { askActivity } from '../providers/askActivity.js';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Clock, Effect } from 'effect';
import { AccountCredentials } from '../providers/contract/service/access.js';
import { askFailure, ModelAsks, type ModelSelection } from '../providers/contract/service/asks.js';
import { notWarm, ThreadAsks, type ThreadAskBasis } from './contract/service/asks.js';
import { HarnessAsides } from './contract/service/asides.js';

const basisOf = (copy: AgentAside, selection: ModelSelection): ThreadAskBasis => ({
  ...selection,
  source: copy.source,
  runId: copy.runId,
  stepNumber: copy.stepNumber,
  readerInput: copy.readerInput,
  readerPosition: copy.readerPosition,
  expiresAt: copy.expiresAt,
});

export const makeThreadAsks = Effect.gen(function* () {
  const asides = yield* HarnessAsides;
  const asks = yield* ModelAsks;
  const log = yield* ActivityLog;
  const credentials = yield* AccountCredentials;

  return ThreadAsks.of({
    held: (threadId) => asides.of(threadId),
    standing: Effect.fn('ThreadAsks.standing')(function* (copy, current) {
      if (copy.source === 'session')
        return {
          _tag: 'Standing',
          basis: basisOf(copy, {
            provider: copy.binding.origin?.provider ?? current.provider,
            model: copy.binding.origin?.model ?? current.model,
            reasoning: copy.reasoning,
            account: null,
          }),
        } as const;
      const resolved = asks.resolve(current);
      if (!ModelIdentity.same(resolved.origin, copy.binding.origin)) return { _tag: 'Moved', reason: 'model-changed' } as const;
      const account = yield* credentials.account(current.provider, current.account ?? undefined);
      if (account !== copy.binding.account) return { _tag: 'Moved', reason: 'account-changed' } as const;
      if (resolved.reasoning !== copy.reasoning) return { _tag: 'Moved', reason: 'rung-changed' } as const;
      return { _tag: 'Standing', basis: basisOf(copy, current) } as const;
    }),
    over: Effect.fn('ThreadAsks.over')(function* (threadId, instruction, copy) {
      const held = copy ?? asides.of(threadId);
      if (held === undefined) return yield* notWarm('This thread holds no warm copy of its conversation to ask over.');
      if (held.expiresAt !== null && held.expiresAt <= (yield* Clock.currentTimeMillis))
        return yield* notWarm("This copy of the thread's conversation is past its cache deadline.");
      return yield* askActivity(
        { kind: 'text', path: 'thread', provider: held.binding.origin?.provider, model: held.binding.origin?.model, rung: held.reasoning },
        asides.ask(threadId, held, { instruction }).pipe(
          Effect.catchTag('LLM.Error', (failure) => Effect.fail(askFailure(failure))),
          Effect.map((answer) => ({ ...answer, account: held.binding.account })),
        ),
        { thread: threadId, run: held.runId },
      ).pipe(Effect.provideService(ActivityLog, log));
    }),
  });
});
