import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import * as LLM from '@runlith/llm/call';
import * as AnthropicMessages from '@runlith/llm/protocols/anthropic-messages';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { resolveModelCall } from '@runlith/llm/models/resolve';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { ANTHROPIC_PROVIDER } from '../models/anthropic';
import { anthropicConsoleRegistration } from './anthropic';

const credentials: ModelCredentials = {
  apiKey: async () => 'sk-ant-test',
  accessToken: async () => {
    throw new Error('the console signs with a key');
  },
  credential: async () => {
    throw new Error('the console signs with a key');
  },
};

const catalog = modelCatalog([anthropicConsoleRegistration]);

const bodyFor = Effect.fnUntraced(function* (model: string, reasoning: string) {
  const resolved = yield* Effect.fromResult(
    resolveModelCall(catalog, { ownerId: 'owner', provider: ANTHROPIC_PROVIDER, model, reasoning, credentials }),
  );
  const routed = yield* resolved.model;
  return yield* AnthropicMessages.protocol.body.from(
    LLM.request({ model: routed, prompt: 'Hello', providerOptions: resolved.providerOptions }),
  );
});

describe('the console asks a model for thinking the way that model takes it', () => {
  it.effect('an adaptive model gets adaptive thinking at the chosen effort, never a fixed budget', () =>
    Effect.gen(function* () {
      const body = yield* bodyFor('claude-haiku-5-5', 'low');

      expect(body.thinking).toEqual({ type: 'adaptive' });
      expect(body.output_config).toEqual({ effort: 'low' });
    }),
  );

  it.effect('a budgeted model keeps its thinking budget', () =>
    Effect.gen(function* () {
      const body = yield* bodyFor('claude-opus-4-5', 'high');

      expect(body.thinking?.type).toBe('enabled');
    }),
  );
});
