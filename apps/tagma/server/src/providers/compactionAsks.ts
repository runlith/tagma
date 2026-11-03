import type { ModelOneShotInput, ModelRequest, ModelRequestInput } from '@runlith/agent/modelPort';
import {
  AuthenticationReason,
  InvalidProviderOutputReason,
  InvalidRequestReason,
  LLMError,
  QuotaExceededReason,
  StreamStalledReason,
  UnknownProviderReason,
} from '@runlith/llm/schema/errors';
import { LLMResponse } from '@runlith/llm/schema/events';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { Message } from '@runlith/llm/schema/messages';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Effect, Layer, Stream } from 'effect';
import { programOutput } from './asks.js';
import { ModelAccess } from './contract/service/access.js';
import { CompactionAsks, ModelAsks, ProgramStalled, type AskRefused, type AskSelection } from './contract/service/asks.js';
import { ProviderRegistry } from './contract/service/registry.js';

const failureOf = (refusal: AskRefused): LLMError => {
  const message = refusal.message;
  const reason =
    refusal.failure instanceof ProgramStalled
      ? new StreamStalledReason({ message, idleMs: refusal.failure.idleMs })
      : refusal.refusal === 'ask-quota'
        ? new QuotaExceededReason({ message })
        : refusal.refusal === 'ask-not-connected'
          ? new AuthenticationReason({ message, kind: 'missing' })
          : refusal.refusal === 'ask-input-too-large'
            ? new InvalidRequestReason({ message, classification: 'context-overflow' })
            : refusal.refusal === 'ask-unreadable-answer'
              ? new InvalidProviderOutputReason({ message })
              : new UnknownProviderReason({ message });
  return new LLMError({ module: 'CompactionAsks', method: 'text', reason });
};

const promptOf = (call: ModelOneShotInput): string =>
  call.prompt ??
  (call.messages ?? []).flatMap((message) => message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []))).join('\n\n');

export const makeCompactionAsks = Effect.gen(function* () {
  const models = yield* ModelAccess;
  const asks = yield* ModelAsks;
  const registry = yield* ProviderRegistry;

  const programRequest = (input: ModelRequestInput, model: string, plannedOutputTokens: number): ModelRequest => {
    const selection: AskSelection = { provider: input.provider, model, reasoning: input.reasoning ?? null, account: input.account ?? null };
    let account: string | undefined;
    const unsupported = Effect.fail(
      new LLMError({
        module: 'CompactionAsks',
        method: 'request',
        reason: new UnknownProviderReason({ message: `${input.provider} summarizes through a program, with text only` }),
      }),
    );
    return {
      system: input.instructions,
      rung: selection.reasoning,
      origin: new ModelIdentity({ provider: ProviderID.make(input.provider), model: ModelID.make(model) }),
      plannedOutputTokens,
      signedAccount: () => account,
      stream: () => Stream.fromEffect(unsupported),
      object: () => unsupported,
      text: (call) =>
        asks
          .text(selection, {
            system: input.instructions ?? '',
            input: promptOf(call),
            stallMs: call.stallMs ?? input.stallMs,
            runId: input.runId,
          })
          .pipe(
            Effect.map((answered) => {
              account = answered.account;
              return new LLMResponse({
                message: Message.assistant(answered.value),
                events: [{ type: 'text-delta', id: 'answer', text: answered.value }],
                usage: answered.usage,
                finishReason: 'stop',
              });
            }),
            Effect.mapError((refusal) => {
              account = refusal.account;
              return failureOf(refusal);
            }),
          ),
    };
  };

  return CompactionAsks.of({
    request: (input) => {
      const catalog = input.runId === undefined ? registry.current() : registry.forRun(input.runId);
      const model = input.model ?? (catalog.models.registered(input.provider) ? catalog.models.defaultTextModelId(input.provider) : null);
      const route = model === null ? null : catalog.asks.route(input.provider, model);
      if (model === null || route === null || (route.provider === input.provider && route.path === 'request')) return models.request(input);
      if (route.path === 'request') return models.request({ ...input, provider: route.provider });
      const capacity = catalog.models.modelsOf(input.provider).find((option) => option.id === model)?.capacity;
      return programRequest(input, model, programOutput(capacity));
    },
    served: (provider, model, runId) => models.served(provider, model, runId),
    defaultModel: (provider, runId) => models.defaultModel(provider, runId),
  });
});

export const compactionAsksLayer = Layer.effect(CompactionAsks, makeCompactionAsks);
