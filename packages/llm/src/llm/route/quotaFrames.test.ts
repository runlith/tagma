import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';
import * as LLM from '../call';
import * as OpenAIResponses from '../protocols/openai-responses';
import { protocol as responsesProtocol } from '../protocols/openai-responses';
import { QuotaObservation } from '../schema/quota';
import { Route } from './definition';
import { Endpoint } from './endpoint';
import { httpExecutorLayer } from './executor';
import * as Framing from './framing';
import { fold, llmClientLayer } from './client';

const wire = (answer: (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<HttpClientResponse.HttpClientResponse>) => ({
  layer: httpExecutorLayer.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => answer(request)),
      ),
    ),
  ),
});

type Wire = ReturnType<typeof wire>;

const events: Array<unknown> = [];

const foldOver = (open: Wire, request: ReturnType<typeof LLM.request>) =>
  fold(request, (event) => events.push(event)).pipe(Effect.provide(llmClientLayer.pipe(Layer.provide(open.layer))));

const hello = (model: Parameters<typeof LLM.request>[0]['model']) => LLM.request({ model, prompt: 'Hello' });

const streaming = (body: string, headers: Record<string, string> = {}) =>
  wire((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', ...headers } }),
      ),
    ),
  );

const COMPLETED = 'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n';

it.effect('a stream-frame quota rides the call step-finish event', () =>
  Effect.gen(function* () {
    events.length = 0;
    const open = streaming('data: {"type":"response.audio.delta","usage-shape":{"used_percent":12.5}}\n\n' + COMPLETED);
    const model = OpenAIResponses.route
      .with({
        provider: 'frames-test',
        endpoint: { baseURL: 'https://provider.test/v1' },
        quotaFrames: (frame, observedAt) =>
          typeof frame === 'string' && frame.includes('"usage-shape"')
            ? new QuotaObservation({
                observedAt,
                source: 'reply',
                windows: [],
              })
            : null,
      })
      .model({ id: 'model-test' });

    yield* foldOver(open, hello(model));

    expect(events).toContainEqual(expect.objectContaining({ type: 'step-finish', quota: expect.any(QuotaObservation) }));
  }),
);

it.effect('make() carries a quota-frames hook onto the built route', () =>
  Effect.sync(() => {
    const quotaFrames = () => null;
    const route = Route.make({
      id: 'frames-make-test',
      protocol: responsesProtocol,
      endpoint: Endpoint.path('/responses', { baseURL: 'https://provider.test/v1' }),
      framing: Framing.sse,
      quotaFrames,
    });

    expect(route.quotaFrames).toBe(quotaFrames);
  }),
);

it.effect('a quota frame trailing the terminal event rides the step finish, which stays last', () =>
  Effect.gen(function* () {
    events.length = 0;
    const open = streaming(
      'data: {"type":"response.output_text.delta","delta":"ok","item_id":"t"}\n\n' +
        COMPLETED +
        'data: {"type":"response.subscription_usage","subscription":{"window":{"used_percent":7}}}\n\n' +
        'data: [DONE]\n\n',
    );
    const model = OpenAIResponses.route
      .with({
        provider: 'frames-test',
        endpoint: { baseURL: 'https://provider.test/v1' },
        quotaFrames: (frame, observedAt) =>
          typeof frame === 'string' && frame.includes('"response.subscription_usage"')
            ? new QuotaObservation({ observedAt, source: 'reply', windows: [] })
            : null,
      })
      .model({ id: 'model-test' });

    yield* foldOver(open, hello(model));

    const finish = events.findLast((event) => (event as { type: string }).type === 'step-finish');
    expect(finish).toEqual(expect.objectContaining({ quota: expect.any(QuotaObservation) }));
    expect(events.at(-1)).toBe(finish);
  }),
);

it.effect('a tail that fails after the finish is not the step failing', () =>
  Effect.gen(function* () {
    events.length = 0;
    let pulls = 0;
    const open = wire((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(
            new ReadableStream({
              pull(controller) {
                if (pulls++ === 0) controller.enqueue(new TextEncoder().encode(COMPLETED));
                else controller.error(new Error('socket closed'));
              },
            }),
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
          ),
        ),
      ),
    );
    const model = OpenAIResponses.route
      .with({ provider: 'frames-test', endpoint: { baseURL: 'https://provider.test/v1' }, quotaFrames: () => null })
      .model({ id: 'model-test' });

    yield* foldOver(open, hello(model));

    expect(events.at(-1)).toEqual(expect.objectContaining({ type: 'step-finish' }));
  }),
);

it.effect('a frame that is not a quota answer keeps the header observation', () =>
  Effect.gen(function* () {
    events.length = 0;
    const observation = new QuotaObservation({
      observedAt: new Date('2026-09-02T12:00:00Z'),
      source: 'reply',
      windows: [],
    });
    const open = streaming('data: {"type":"response.audio.delta"}\n\n' + COMPLETED, { 'x-provider-quota': 'seen' });
    const model = OpenAIResponses.route
      .with({
        provider: 'frames-test',
        endpoint: { baseURL: 'https://provider.test/v1' },
        quota: (headers) => (headers['x-provider-quota'] === 'seen' ? observation : null),
        quotaFrames: () => null,
      })
      .model({ id: 'model-test' });

    yield* foldOver(open, hello(model));

    expect(events).toContainEqual(expect.objectContaining({ type: 'step-finish', quota: observation }));
  }),
);
