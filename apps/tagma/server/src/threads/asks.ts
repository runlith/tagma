import type { AgentAside } from '@runlith/agent/AgentAside';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Effect } from 'effect';
import { OPERATOR_PRINCIPAL } from '../platform/contract/wire/actor.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { AccountCredentials, ModelAccess } from '../providers/contract/service/access.js';
import { ThreadAsks, type ThreadAskBasis, type ThreadSelection } from './contract/service/asks.js';
import { HarnessAsides } from './contract/service/engine.js';

const notWarm = (reason: string) =>
  new GateRefusal('not-warm', reason, ['send a message in this thread, then ask again while its prompt cache is warm']);

const basisOf = (copy: AgentAside, selection: ThreadSelection): ThreadAskBasis => ({
  ...selection,
  source: copy.source,
  runId: copy.runId,
  stepNumber: copy.stepNumber,
  readerInput: copy.readerInput,
  readerPosition: copy.readerPosition,
  expiresAt: copy.expiresAt,
});

const servedBy = (copy: AgentAside, fallback?: ThreadSelection): ThreadSelection => ({
  provider: copy.binding.origin?.provider ?? fallback?.provider ?? '',
  model: copy.binding.origin?.model ?? fallback?.model ?? null,
  reasoning: copy.reasoning,
  account: copy.source === 'session' ? null : (copy.binding.account ?? null),
});

export const makeThreadAsks = Effect.gen(function* () {
  const asides = yield* HarnessAsides;
  const models = yield* ModelAccess;
  const credentials = yield* AccountCredentials;

  return ThreadAsks.of({
    held: (threadId) => asides.of(threadId),
    standing: Effect.fnUntraced(function* (copy, current) {
      if (copy.source === 'session') return { _tag: 'Standing', basis: basisOf(copy, servedBy(copy, current)) } as const;
      const request = models.request({
        ownerId: OPERATOR_PRINCIPAL,
        provider: current.provider,
        model: current.model,
        reasoning: current.reasoning,
      });
      if (!ModelIdentity.same(request.origin, copy.binding.origin)) return { _tag: 'Moved', reason: 'model-changed' } as const;
      const account = yield* credentials
        .account(current.provider, current.account ?? undefined)
        .pipe(Effect.mapError((failure) => notWarm(`The thread's account cannot be read: ${failure.message}`)));
      if (account !== copy.binding.account) return { _tag: 'Moved', reason: 'account-changed' } as const;
      if ((request.rung ?? null) !== copy.reasoning) return { _tag: 'Moved', reason: 'rung-changed' } as const;
      return { _tag: 'Standing', basis: basisOf(copy, current) } as const;
    }),
    over: Effect.fnUntraced(function* (threadId, instruction, copy) {
      const held = copy ?? asides.of(threadId);
      if (held === undefined) return yield* notWarm('This thread holds no warm copy of its conversation to ask over.');
      const answer = yield* asides.ask(threadId, held, { instruction });
      return { answer, basis: basisOf(held, servedBy(held)) };
    }),
  });
});
