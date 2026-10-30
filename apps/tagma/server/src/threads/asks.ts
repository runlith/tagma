import type { AgentAside } from '@runlith/agent/AgentAside';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Clock, Effect } from 'effect';
import { OPERATOR_PRINCIPAL } from '../platform/contract/wire/actor.js';
import { AccountCredentials, ModelAccess } from '../providers/contract/service/access.js';
import { notWarm, ThreadAsks, type ThreadAskBasis, type ThreadSelection } from './contract/service/asks.js';
import { HarnessAsides } from './contract/service/asides.js';

const basisOf = (copy: AgentAside, selection: ThreadSelection): ThreadAskBasis => ({
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
  const models = yield* ModelAccess;
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
      const request = models.request({
        ownerId: OPERATOR_PRINCIPAL,
        provider: current.provider,
        model: current.model,
        reasoning: current.reasoning,
      });
      if (!ModelIdentity.same(request.origin, copy.binding.origin)) return { _tag: 'Moved', reason: 'model-changed' } as const;
      const account = yield* credentials.account(current.provider, current.account ?? undefined);
      if (account !== copy.binding.account) return { _tag: 'Moved', reason: 'account-changed' } as const;
      if ((request.rung ?? null) !== copy.reasoning) return { _tag: 'Moved', reason: 'rung-changed' } as const;
      return { _tag: 'Standing', basis: basisOf(copy, current) } as const;
    }),
    over: Effect.fn('ThreadAsks.over')(function* (threadId, instruction, copy) {
      const held = copy ?? asides.of(threadId);
      if (held === undefined) return yield* notWarm('This thread holds no warm copy of its conversation to ask over.');
      if (held.expiresAt !== null && held.expiresAt <= (yield* Clock.currentTimeMillis))
        return yield* notWarm("This copy of the thread's conversation is past its cache deadline.");
      return yield* asides.ask(threadId, held, { instruction });
    }),
  });
});
