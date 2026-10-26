import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { Headers } from 'effect/http';
import * as LLM from '@runlith/llm/call';
import * as Gemini from '@runlith/llm/protocols/gemini';
import { Endpoint } from '@runlith/llm/route/endpoint';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { resolveModelCall } from '@runlith/llm/models/resolve';
import { OPENCODE_GO_PROVIDER } from '../models/opencodeGo';
import { OPENCODE_GO_BASE_URL, opencodeGoRegistration, opencodeGoUsage, opencodeGoUserAgent } from './opencodeGo';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { RECORDED_PRODUCT } from '@runlith/llm/profiles/recordedProduct';

const credentials: ModelCredentials = {
  apiKey: async () => 'oc_sk_test',
  accessToken: async () => {
    throw new Error('OpenCode Go signs with a console key, not a subscription token');
  },
  credential: async () => ({
    accessToken: 'token',
    refreshToken: 'refresh',
    expiresAt: 0,
    scope: '',
    account: { uuid: 'account-uuid', email: 'operator@example.com' },
    organization: { uuid: 'organization-uuid', name: '' },
    accountId: undefined,
  }),
};

const registration = opencodeGoRegistration(RECORDED_PRODUCT);
const catalog = modelCatalog([registration]);

const routeModel = (model: string, cacheGroup?: string) =>
  Effect.fromResult(resolveModelCall(catalog, { ownerId: 'owner', provider: OPENCODE_GO_PROVIDER, model, cacheGroup, credentials })).pipe(
    Effect.flatMap((resolved) => resolved.model),
  );

const headersFor = Effect.fnUntraced(function* (model: string) {
  const routed = yield* routeModel(model);
  return yield* routed.route.auth.apply({
    request: LLM.request({ model: routed, prompt: 'Hello' }),
    method: 'POST',
    url: `${OPENCODE_GO_BASE_URL}/chat/completions`,
    body: '{}',
    headers: Headers.fromInput(routed.route.defaults.headers ?? {}),
  });
});

describe('one registration selects the wire by model id', () => {
  it.effect('a chat-completions model signs with a bearer and never an anthropic key header', () =>
    Effect.gen(function* () {
      const headers = yield* headersFor('glm-5.3-flash');

      expect(headers.authorization).toBe('Bearer oc_sk_test');
      expect(headers['x-api-key']).toBeUndefined();
    }),
  );

  it.effect('a messages model signs where an Anthropic client puts its key, and sends no bearer', () =>
    Effect.gen(function* () {
      const headers = yield* headersFor('minimax-m3');

      expect(headers['x-api-key']).toBe('oc_sk_test');
      expect(headers.authorization).toBeUndefined();
    }),
  );

  it.effect('a Gemini model signs where a Google client puts its key, and sends no bearer', () =>
    Effect.gen(function* () {
      const headers = yield* headersFor('gemini-4-argon-contributor');

      expect(headers['x-goog-api-key']).toBe('oc_sk_test');
      expect(headers.authorization).toBeUndefined();
    }),
  );

  it.effect('a Gemini rung reaches the body as its thinking level, with thoughts shown', () =>
    Effect.gen(function* () {
      const routed = yield* routeModel('gemini-4-argon-contributor');
      const options = registration.profile.options?.({
        model: 'gemini-4-argon-contributor',
        rung: 'medium',
        adaptive: false,
        reasoningOutput: true,
        outputTokens: 32_000,
        switches: {},
      });
      const body = yield* Gemini.protocol.body.from(LLM.request({ model: routed, prompt: 'Hello', providerOptions: options }));

      expect(body.generationConfig?.thinkingConfig).toEqual({ thinkingLevel: 'medium', includeThoughts: true });
    }),
  );

  it.effect('each wire keeps its own path under the one Go base URL', () =>
    Effect.gen(function* () {
      const paths = yield* Effect.forEach(
        ['glm-5.3-flash', 'muse-spark-1.3-contributor', 'minimax-m3', 'gemini-4-argon-contributor'],
        (id) =>
          routeModel(id).pipe(
            Effect.map(
              (routed) =>
                Endpoint.render(routed.route.endpoint, { request: LLM.request({ model: routed, prompt: 'Hello' }), body: {} }).href,
            ),
          ),
      );

      expect(paths).toEqual([
        'https://opencode.ai/inference/go/v1/chat/completions',
        'https://opencode.ai/inference/go/v1/responses',
        'https://opencode.ai/inference/go/v1/messages',
        'https://opencode.ai/inference/go/v1/models/gemini-4-argon-contributor:streamGenerateContent?alt=sse',
      ]);
    }),
  );

  it.effect('a model this build declares no wire for fails the call instead of defaulting onto one', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.exit(registration.profile.model({ ownerId: 'owner', model: 'glm-5', credentials }));

      expect(outcome._tag).toBe('Failure');
    }),
  );
});

it.effect('every served model is bound to a wire, and every bound wire has a served model', () =>
  Effect.gen(function* () {
    const unbound: string[] = [];
    for (const id of Object.keys(registration.models)) {
      const outcome = yield* Effect.exit(registration.profile.model({ ownerId: 'owner', model: id, credentials }));
      if (outcome._tag === 'Failure') unbound.push(id);
    }

    expect(unbound).toEqual([]);
    expect(Object.keys(registration.models).length).toBeGreaterThan(20);
  }),
);

describe('every Go call names this client', () => {
  it.effect('its own agent line rides every wire', () =>
    Effect.gen(function* () {
      for (const id of ['glm-5.3-flash', 'muse-spark-1.3-contributor', 'minimax-m3', 'gemini-4-argon-contributor']) {
        const routed = yield* routeModel(id);

        expect(routed.route.defaults.headers?.['User-Agent']).toBe(opencodeGoUserAgent(RECORDED_PRODUCT));
      }
    }),
  );

  it.effect('one cache group is one session id, and two groups are two', () =>
    Effect.gen(function* () {
      const first = yield* routeModel('glm-5.3-flash', 'thread-1');
      const same = yield* routeModel('minimax-m3', 'thread-1');
      const other = yield* routeModel('glm-5.3-flash', 'thread-2');

      const session = first.route.defaults.headers?.['x-opencode-session'];
      expect(session).toBeDefined();
      expect(same.route.defaults.headers?.['x-opencode-session']).toBe(session!);
      expect(other.route.defaults.headers?.['x-opencode-session']).not.toBe(session!);
    }),
  );
});

describe('the usage answer becomes three windows', () => {
  const payload = {
    usage: {
      rolling: { status: 'ok', percent: 12, resetsAt: '2026-09-18T02:00:00.000Z' },
      weekly: { status: 'ok', percent: 4, resetsAt: '2026-09-21T00:00:00.000Z' },
      monthly: { status: 'rate-limited', percent: 100, resetsAt: '2026-10-17T00:00:00.000Z' },
    },
  };

  it.effect('each reported window keeps its own kind, and only the rolling one states a length', () =>
    Effect.gen(function* () {
      const observation = yield* opencodeGoUsage(payload, new Date(0));

      expect(observation.source).toBe('usage');
      expect(observation.windows.map((window) => [window.kind, window.usedPercent, window.windowMinutes])).toEqual([
        ['bucket', 12, 300],
        ['weekly', 4, undefined],
        ['monthly', 100, undefined],
      ]);
    }),
  );

  it.effect('an answer that is not the usage shape refuses rather than reporting zero', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.exit(opencodeGoUsage({ usage: { rolling: {} } }, new Date(0)));

      expect(outcome._tag).toBe('Failure');
    }),
  );
});
