import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, type Exit, Tracer } from 'effect';
import { LLMRequest } from '../schema/messages';
import { Model } from '../schema/options';
import { protocol as anthropic, route as anthropicRoute } from './anthropic-messages';
import { protocol as openaiResponses } from './openai-responses';

const recordingTracer = (names: string[]) =>
  Tracer.make({
    span(options) {
      names.push(options.name);
      const attributes = new Map<string, unknown>();
      return {
        _tag: 'Span' as const,
        spanId: `span-${names.length}`,
        traceId: 'trace-1',
        name: options.name,
        parent: options.parent,
        annotations: options.annotations,
        status: { _tag: 'Started' as const, startTime: options.startTime },
        attributes,
        links: options.links,
        sampled: options.sampled,
        kind: options.kind,
        end: (_endTime: bigint, _exit: Exit.Exit<unknown, unknown>) => {},
        attribute: (key: string, value: unknown) => void attributes.set(key, value),
        event: () => {},
        addLinks: () => {},
      } as unknown as Tracer.Span;
    },
  });

const request = new LLMRequest({
  model: Model.make({ id: 'model-test', provider: 'anthropic', route: anthropicRoute }),
  system: [],
  messages: [],
  tools: [],
});

const drive = Effect.fnUntraced(function* <State, Event>(
  stream: {
    readonly initial: (request: LLMRequest) => State;
    readonly step: (state: State, event: Event) => Effect.Effect<readonly [State, unknown], unknown>;
  },
  events: ReadonlyArray<Event>,
) {
  const names: string[] = [];
  let state = stream.initial(request);
  for (const event of events) {
    const [next] = yield* (stream.step(state, event) as Effect.Effect<readonly [State, unknown], any>).pipe(
      Effect.provideService(Tracer.Tracer, recordingTracer(names)),
    );
    state = next;
  }
  return names;
});

it.effect('the recorder sees the spans the request path opens', () =>
  Effect.gen(function* () {
    const names: string[] = [];
    yield* anthropic.body.from(request).pipe(Effect.provideService(Tracer.Tracer, recordingTracer(names)));
    expect(names).toContain('AnthropicMessages.fromRequest');
    expect(names).toContain('AnthropicMessages.lowerMessages');
  }),
);

it.effect('an Anthropic content delta opens no span', () =>
  Effect.gen(function* () {
    const deltas = Array.from({ length: 64 }, (_, index) => ({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: `token ${index} ` },
    }));
    const names = yield* drive(
      anthropic.stream as never,
      [{ type: 'message_start', message: { usage: { input_tokens: 4 } } }, ...deltas, { type: 'content_block_stop', index: 0 }] as never,
    );
    expect(names).toEqual([]);
  }),
);

it.effect('an OpenAI Responses argument delta and item completion open no span', () =>
  Effect.gen(function* () {
    const deltas = Array.from({ length: 64 }, () => ({
      type: 'response.function_call_arguments.delta',
      item_id: 'item-1',
      delta: '{"a":',
    }));
    const names = yield* drive(
      openaiResponses.stream as never,
      [
        {
          type: 'response.output_item.added',
          item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'read' },
        },
        ...deltas,
        {
          type: 'response.output_item.done',
          item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'read', arguments: '{"a":1}' },
        },
      ] as never,
    );
    expect(names).toEqual([]);
  }),
);
