import { it } from '@runlith/effect-test';
import { Layer } from 'effect';
import { describe, expect, test } from 'bun:test';
import { arch, platform, release } from 'node:os';
import { Effect, Stream } from 'effect';
import { Headers } from 'effect/http';
import { answering, type Sent } from '@runlith/llm/route/transport/answering';
import { QuotaDoor } from '@runlith/llm/profiles/quotaRead';
import * as LLM from '@runlith/llm/call';
import type { LLMRequest } from '@runlith/llm/schema/messages';
import type { Model } from '@runlith/llm/schema/options';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { resolveModelCall } from '@runlith/llm/models/resolve';
import { openaiConsoleRegistration, openaiSubscriptionRegistration } from './openai';
import type { ModelCredentials, ModelProfile, ProductIdentity, ProfileCall } from '@runlith/llm/profiles/contract';
import { generate, prepare, stream } from '@runlith/llm/route/client';
import { MAX_RETRIES } from '@runlith/llm/route/executor';
import { openModelClient } from '@runlith/llm/models/client';

const product: ProductIdentity = { mcpServer: 'test-client', client: { name: 'test-client', version: '3.2.1' } };
const subscription = openaiSubscriptionRegistration(product);
const openaiQuota = subscription.quota;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const credentials: ModelCredentials = {
  apiKey: async () => 'sk-test',
  accessToken: async () => 'oauth-token',
  credential: async () => ({
    accessToken: 'token',
    refreshToken: 'refresh',
    expiresAt: 0,
    scope: '',
    account: { uuid: 'account-uuid', email: 'operator@example.com' },
    organization: { uuid: 'organization-uuid', name: '' },
    accountId: 'account-1',
  }),
};

const call = (cacheGroup?: string, serviceTier: string | null = null): ProfileCall => ({
  model: 'gpt-5.5',
  rung: null,
  adaptive: false,
  reasoningOutput: false,
  outputTokens: 32_000,
  switches: serviceTier === null ? {} : { serviceTier },
  cacheGroup,
});

const requestFor = Effect.fnUntraced(function* (profile: ModelProfile, cacheGroup?: string, serviceTier: string | null = null) {
  const model = yield* profile.model({ ownerId: 'owner', model: 'gpt-5.5', cacheGroup, credentials });
  return LLM.request({ model, prompt: 'Hello', providerOptions: profile.options(call(cacheGroup, serviceTier)) });
});

const catalog = modelCatalog([subscription]);
const resolvedRequest = Effect.fnUntraced(function* (model: string, serviceTier: string | null) {
  const resolved = yield* Effect.fromResult(
    resolveModelCall(catalog, {
      ownerId: 'owner',
      provider: subscription.id,
      model,
      switches: serviceTier === null ? {} : { serviceTier },
      credentials,
    }),
  );
  const routeModel = yield* resolved.model;
  return LLM.request({ model: routeModel, prompt: 'Hello', providerOptions: resolved.providerOptions });
});

const signed = (model: Model, request: LLMRequest) =>
  model.route.auth.apply({
    request,
    method: 'POST',
    url: 'https://example.invalid/responses',
    body: '{}',
    headers: Headers.fromInput({}),
  });

it.live('an OpenAI subscription one-shot rereads its rejected bearer once and then requires reconnection', () =>
  Effect.gen(function* () {
    let token = 'old';
    const given: ModelCredentials = {
      ...credentials,
      accessToken: async () => token,
      recoverAccessToken: async () => {
        token = 'fresh';
        return token;
      },
    };
    const model = yield* subscription.profile.model({ ownerId: 'owner', model: 'gpt-5.5', credentials: given });
    const sent: string[] = [];
    const door = answering((request) => {
      sent.push(request.headers.authorization!);
      return new Response('{"error":{"message":"Rejected"}}', {
        status: 401,
        headers: { 'content-type': 'application/json', 'x-should-retry': 'true' },
      });
    });
    const failure = yield* Effect.flip(generate(LLM.request({ model, prompt: 'Hello' }))).pipe(
      Effect.provide(Layer.effectContext(openModelClient(door))),
    );
    expect(failure.reason).toMatchObject({ _tag: 'Authentication', kind: 'expired' });
    expect(sent).toEqual(['Bearer old', 'Bearer fresh']);
  }),
);

it.live('a direct subscription stream retains ordinary HTTP retries with a recovery-only policy', () =>
  Effect.gen(function* () {
    const request = yield* requestFor(subscription.profile);
    let calls = 0;
    const door = answering(() =>
      ++calls === 1
        ? new Response('{"error":{"message":"Busy"}}', { status: 503, headers: { 'retry-after': '0' } })
        : new Response(
            'data: {"type":"response.output_text.delta","delta":"Recovered"}\n\ndata: {"type":"response.completed","response":{}}\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          ),
    );
    const events = yield* Effect.scoped(
      Effect.gen(function* () {
        return yield* Stream.runCollect(stream(request, yield* Effect.scope));
      }),
    ).pipe(Effect.provide(Layer.effectContext(openModelClient(door))));
    expect(events).toContainEqual(expect.objectContaining({ type: 'text-delta', text: 'Recovered' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'finish', reason: 'stop' }));
    expect(calls).toBe(2);
  }),
);

it.live('a recovery-only subscription one-shot does not add a second ordinary HTTP retry ladder', () =>
  Effect.gen(function* () {
    const request = yield* requestFor(subscription.profile);
    let calls = 0;
    const door = answering(() => {
      calls += 1;
      return new Response('{"error":{"message":"Busy"}}', { status: 503, headers: { 'retry-after': '0' } });
    });
    const failure = yield* Effect.flip(generate(request)).pipe(Effect.provide(Layer.effectContext(openModelClient(door))));
    expect(failure.status).toBe(503);
    expect(calls).toBe(MAX_RETRIES + 1);
  }),
);

describe('a cache group is spelled by the deployment that sends it', () => {
  it.effect('the console carries the group in the request body and signs no session header', () =>
    Effect.gen(function* () {
      const request = yield* requestFor(openaiConsoleRegistration.profile, 'conversation-1');
      const prepared = yield* prepare<{ prompt_cache_key?: string }>(request);
      const headers = yield* signed(request.model, request);
      expect(prepared.body.prompt_cache_key).toBe('conversation-1');
      expect(headers['session-id']).toBeUndefined();
    }),
  );

  it.effect('a subscription names its calling product and carries a session without an explicit group', () =>
    Effect.gen(function* () {
      const request = yield* requestFor(subscription.profile);
      const headers = yield* signed(request.model, request);
      expect(headers.originator).toBe('test-client');
      expect(headers['user-agent']).toMatch(/^test-client\/3\.2\.1 \([^)]+; [^)]+\)$/);
      expect(headers['user-agent']).toContain(`(${platform()} ${release()}; ${arch()})`);
      expect(headers['chatgpt-account-id']).toBe('account-1');
      expect(headers['session-id']).toMatch(UUID_V4);
      expect(headers['x-codex-routing-hint']).toBe('model=gpt-5.5');
    }),
  );

  it.effect('separate calling products retain their own identity', () =>
    Effect.gen(function* () {
      const other = openaiSubscriptionRegistration({ mcpServer: 'other-client', client: { name: 'other-client', version: '7.4.2' } });
      const otherRequest = yield* requestFor(other.profile);
      const firstRequest = yield* requestFor(subscription.profile);
      expect((yield* signed(firstRequest.model, firstRequest)).originator).toBe('test-client');
      expect((yield* signed(otherRequest.model, otherRequest)).originator).toBe('other-client');
      expect((yield* signed(otherRequest.model, otherRequest))['user-agent']).toMatch(/^other-client\/7\.4\.2 \([^)]+; [^)]+\)$/);
    }),
  );

  it.effect('one group is one backend session, and two groups are two', () =>
    Effect.gen(function* () {
      const first = yield* requestFor(subscription.profile, 'conversation-1');
      const again = yield* requestFor(subscription.profile, 'conversation-1');
      const other = yield* requestFor(subscription.profile, 'conversation-2');
      const firstSession = (yield* signed(first.model, first))['session-id'];
      expect(firstSession).toMatch(UUID_V4);
      expect((yield* signed(again.model, again))['session-id']).toBe(firstSession);
      expect((yield* signed(other.model, other))['session-id']).not.toBe(firstSession);
    }),
  );
});

describe('the Codex reply quota family', () => {
  const observedAt = new Date('2026-09-02T12:00:00Z');
  const parserFixture = Headers.fromInput({
    'x-codex-primary-used-percent': '12.5',
    'x-codex-primary-window-minutes': '60',
    'x-codex-primary-reset-at': '1704069000',
    'x-codex-secondary-used-percent': '80',
    'x-codex-secondary-window-minutes': '10080',
    'x-codex-secondary-reset-at': '1704074400',
    'x-codex-bengalfox-primary-used-percent': '70',
    'x-codex-bengalfox-limit-name': 'gpt-5.2-codex-sonic',
  });

  test('the Codex parser fixture yields its session, weekly and labelled bucket windows', () => {
    const observation = openaiQuota.fromHeaders(parserFixture, observedAt);

    expect(observation).not.toBeNull();
    expect(observation?.source).toBe('reply');
    expect(observation?.observedAt).toEqual(observedAt);
    expect(observation?.windows).toEqual([
      expect.objectContaining({
        kind: 'session',
        usedPercent: 12.5,
        windowMinutes: 60,
        resetsAt: 1_704_069_000,
      }),
      expect.objectContaining({
        kind: 'weekly',
        usedPercent: 80,
        windowMinutes: 10_080,
        resetsAt: 1_704_074_400,
      }),
      expect.objectContaining({
        kind: 'bucket',
        label: 'gpt-5.2-codex-sonic',
        usedPercent: 70,
      }),
    ]);
  });

  test('a malformed primary utilization drops only that window', () => {
    const observation = openaiQuota.fromHeaders(Headers.set(parserFixture, 'x-codex-primary-used-percent', 'abc'), observedAt);

    expect(observation?.windows.map((window) => window.kind)).toEqual(['weekly', 'bucket']);
  });

  test('a Spark limit in the reply headers is not surfaced', () => {
    const observation = openaiQuota.fromHeaders(
      Headers.fromInput({
        'x-codex-primary-used-percent': '12.5',
        'x-gpt-5.3-codex-spark-primary-used-percent': '0',
        'x-gpt-5.3-codex-spark-limit-name': 'GPT-5.3-Codex-Spark',
      }),
      observedAt,
    );

    expect(observation?.windows.map((window) => window.kind)).toEqual(['session']);
  });
});

describe('the ChatGPT subscription usage read', () => {
  it.effect('the captured wham answer becomes session, weekly, bucket and reset-credit facts', () =>
    Effect.gen(function* () {
      const fixture = {
        plan_type: 'plus',
        rate_limit: {
          primary_window: { used_percent: 12, limit_window_seconds: 3_600, reset_at: 1_800_000_000 },
          secondary_window: { used_percent: 34, limit_window_seconds: 604_800, reset_at: 1_800_100_000 },
        },
        additional_rate_limits: [
          {
            limit_name: 'codex_other',
            rate_limit: {
              primary_window: { used_percent: 70, limit_window_seconds: 900, reset_at: 1_800_200_000 },
            },
          },
        ],
        rate_limit_reset_credits: { available_count: 3 },
      };
      let sent: Sent | undefined;
      const fetch = answering((request) => {
        sent = request;
        return new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      const observation = yield* openaiQuota.read(credentials, 'owner').pipe(Effect.provideService(QuotaDoor, fetch));

      expect(observation.source).toBe('usage');
      expect(observation.plan).toBe('plus');
      expect(observation.resetCredits).toBe(3);
      expect(observation.windows).toEqual([
        expect.objectContaining({ kind: 'session', usedPercent: 12, windowMinutes: 60, resetsAt: 1_800_000_000 }),
        expect.objectContaining({ kind: 'weekly', usedPercent: 34, windowMinutes: 10_080, resetsAt: 1_800_100_000 }),
        expect.objectContaining({ kind: 'bucket', label: 'codex_other', usedPercent: 70, windowMinutes: 15 }),
      ]);
      expect(sent?.url).toBe('https://chatgpt.com/backend-api/wham/usage');
      expect(sent?.headers['authorization']).toBe('Bearer oauth-token');
      expect(sent?.headers['chatgpt-account-id']).toBe('account-1');
      expect(sent?.headers['user-agent']).toMatch(/^test-client\/3\.2\.1 \([^)]+; [^)]+\)$/);
      expect([sent?.headers['originator'], sent?.headers['version'], sent?.headers['session-id']]).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
    }),
  );

  it.effect('a window takes its kind from its span, and a window of no length is not a window', () =>
    Effect.gen(function* () {
      const fixture = {
        plan_type: 'plus',
        rate_limit: {
          primary_window: { used_percent: 97, limit_window_seconds: 604_800, reset_at: 1_800_000_000 },
          secondary_window: { used_percent: 0, limit_window_seconds: 0, reset_at: 1_800_000_000 },
        },
      };
      const fetch = answering(
        () =>
          new Response(JSON.stringify(fixture), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      );
      const observation = yield* openaiQuota.read(credentials, 'owner').pipe(Effect.provideService(QuotaDoor, fetch));

      expect(observation.windows).toEqual([
        expect.objectContaining({ kind: 'weekly', usedPercent: 97, windowMinutes: 10_080, resetsAt: 1_800_000_000 }),
      ]);
    }),
  );

  it.effect('the fields an account without them answers as null read as absent', () =>
    Effect.gen(function* () {
      const fixture = {
        plan_type: 'pro',
        rate_limit: {
          primary_window: { used_percent: 80, limit_window_seconds: 604_800, reset_after_seconds: 502_552, reset_at: 1_800_000_000 },
          secondary_window: null,
        },
        code_review_rate_limit: null,
        additional_rate_limits: null,
        rate_limit_reset_credits: null,
      };
      const fetch = answering(
        () =>
          new Response(JSON.stringify(fixture), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      );
      const observation = yield* openaiQuota.read(credentials, 'owner').pipe(Effect.provideService(QuotaDoor, fetch));

      expect(observation.plan).toBe('pro');
      expect(observation.resetCredits).toBeUndefined();
      expect(observation.windows).toEqual([expect.objectContaining({ kind: 'weekly', usedPercent: 80, windowMinutes: 10_080 })]);
    }),
  );

  it.effect('a Spark limit in the usage answer is not surfaced', () =>
    Effect.gen(function* () {
      const fixture = {
        plan_type: 'plus',
        rate_limit: {
          primary_window: { used_percent: 12, limit_window_seconds: 3_600, reset_at: 1_800_000_000 },
        },
        additional_rate_limits: [
          {
            limit_name: 'codex_other',
            rate_limit: {
              primary_window: { used_percent: 70, limit_window_seconds: 900, reset_at: 1_800_200_000 },
            },
          },
          {
            limit_name: 'GPT-5.3-Codex-Spark',
            rate_limit: {
              primary_window: { used_percent: 0, limit_window_seconds: 900, reset_at: 1_800_200_000 },
            },
          },
        ],
      };
      const fetch = answering(
        () =>
          new Response(JSON.stringify(fixture), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      );
      const observation = yield* openaiQuota.read(credentials, 'owner').pipe(Effect.provideService(QuotaDoor, fetch));

      expect(observation.windows.map((window) => window.label ?? window.kind)).toEqual(['session', 'codex_other']);
    }),
  );
});

describe('a catalog service tier becomes the OpenAI OAuth request', () => {
  it.effect('Fast prepares priority inference and its matching routing hint', () =>
    Effect.gen(function* () {
      const request = yield* resolvedRequest('gpt-5.5', 'priority');
      const prepared = yield* prepare<{ service_tier?: string }>(request);
      const headers = yield* signed(request.model, request);
      expect(prepared.body.service_tier).toBe('priority');
      expect(headers['x-codex-routing-hint']).toBe('model=gpt-5.5;tier=priority');
    }),
  );

  it.effect('Standard omits the service tier while retaining model routing', () =>
    Effect.gen(function* () {
      const request = yield* resolvedRequest('gpt-5.5', null);
      const prepared = yield* prepare<{ service_tier?: string }>(request);
      const headers = yield* signed(request.model, request);
      expect(prepared.body.service_tier).toBeUndefined();
      expect(headers['x-codex-routing-hint']).toBe('model=gpt-5.5');
    }),
  );
});
