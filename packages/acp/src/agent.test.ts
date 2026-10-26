import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Deferred, Effect, Queue, Stream } from 'effect';
import { ExchangeFailed } from '@runlith/ndjson-rpc/exchange';
import { frame, type Envelope } from '@runlith/ndjson-rpc/envelope';
import { AgentFault, FAULT, serve, type AgentHandlers, type Outlet } from './agent';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Written = ReadonlyArray<Record<string, unknown>>;

const request = (id: number | string, method: string, params: unknown): Envelope => ({ _tag: 'Request', id, method, params });

const served = Effect.fnUntraced(function* (
  frames: ReadonlyArray<Envelope>,
  agent: (outlet: Outlet) => AgentHandlers<never>,
  answers: number,
) {
  const written: Array<Record<string, unknown>> = [];
  const settled = yield* Deferred.make<void>();
  const input = Stream.concat(
    Stream.fromIterable(frames.map((envelope) => encoder.encode(frame(envelope)))),
    Stream.drain(Stream.fromEffect(Deferred.await(settled))),
  );
  yield* serve(
    input,
    Effect.fnUntraced(function* (bytes) {
      for (const line of decoder.decode(bytes).split('\n')) if (line !== '') written.push(JSON.parse(line));
      if (written.filter((envelope) => 'id' in envelope).length >= answers) yield* Deferred.succeed(settled, undefined);
    }),
    1024 * 1024,
    agent,
  );
  return written as Written;
});

const base = (overrides: Partial<AgentHandlers<never>>): AgentHandlers<never> => ({
  initialize: () => Effect.succeed({ protocolVersion: 1 }),
  newSession: () => Effect.succeed({ sessionId: 's1' }),
  prompt: () => Effect.succeed({ stopReason: 'end_turn' }),
  cancel: () => Effect.void,
  extensions: {},
  ended: Effect.void,
  ...overrides,
});

it.effect(
  'a turn waiting for its answer leaves the agent reading, so session/cancel reaches it and the turn ends cancelled after its updates',
  () =>
    Effect.gen(function* () {
      const cancelled = yield* Deferred.make<void>();
      const written = yield* served(
        [
          request(1, 'session/prompt', { sessionId: 's1', prompt: [{ type: 'text', text: 'go' }] }),
          { _tag: 'Notification', method: 'session/cancel', params: { sessionId: 's1' } },
        ],
        (outlet) =>
          base({
            prompt: Effect.fnUntraced(function* (params) {
              yield* outlet.update({
                sessionId: params.sessionId,
                update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'working' } },
              });
              yield* Deferred.await(cancelled);
              return { stopReason: 'cancelled' as const };
            }),
            cancel: () => Deferred.succeed(cancelled, undefined),
          }),
        1,
      );
      expect(written.map((envelope) => envelope.method ?? envelope.id)).toEqual(['session/update', 1]);
      expect(written[1]).toMatchObject({ jsonrpc: '2.0', id: 1, result: { stopReason: 'cancelled' } });
    }),
);

it.effect('a refusal answers with its own code, params outside ACP v1 with -32602, and a method nobody declared with -32601', () =>
  Effect.gen(function* () {
    const written = yield* served(
      [
        request('a', 'session/new', { cwd: '/x', mcpServers: [] }),
        request('b', 'session/prompt', { sessionId: 's1' }),
        request('c', 'session/load', { sessionId: 's1', cwd: '/x', mcpServers: [] }),
        request('d', '_vendor/thing', {}),
      ],
      () =>
        base({
          newSession: () => Effect.fail(new AgentFault({ code: FAULT.authRequired, message: 'sign in first' })),
        }),
      4,
    );
    const byId = new Map(written.map((envelope) => [envelope.id, envelope]));
    expect(byId.get('a')).toMatchObject({ error: { code: FAULT.authRequired, message: 'sign in first' } });
    expect(byId.get('b')).toMatchObject({ error: { code: FAULT.invalidParams } });
    expect(byId.get('c')).toMatchObject({ error: { code: FAULT.methodNotFound } });
    expect(byId.get('d')).toMatchObject({ error: { code: FAULT.methodNotFound } });
  }),
);

it.effect('a declared extension is answered under its own method, and the end of input ends the agent', () =>
  Effect.gen(function* () {
    let ended = false;
    const written = yield* served(
      [request(7, '_tagma/steer', { sessionId: 's1' })],
      () =>
        base({
          extensions: { '_tagma/steer': (params) => Effect.succeed({ outcome: 'injected', echoed: params }) },
          ended: Effect.sync(() => {
            ended = true;
          }),
        }),
      1,
    );
    expect(written).toEqual([{ jsonrpc: '2.0', id: 7, result: { outcome: 'injected', echoed: { sessionId: 's1' } } }]);
    expect(ended).toBe(true);
  }),
);

it.effect('a request the agent sends is answered by the client response that carries its id', () =>
  Effect.gen(function* () {
    const inbox = yield* Queue.unbounded<Uint8Array, Cause.Done>();
    const heard = yield* Deferred.make<unknown, AgentFault>();
    yield* Queue.offer(
      inbox,
      encoder.encode(frame(request(1, 'session/prompt', { sessionId: 's1', prompt: [{ type: 'text', text: 'go' }] }))),
    );
    yield* serve(
      Stream.fromQueue(inbox),
      Effect.fnUntraced(function* (bytes) {
        for (const line of decoder.decode(bytes).split('\n')) {
          if (line === '') continue;
          const envelope = JSON.parse(line) as Record<string, unknown>;
          if (envelope.method === 'session/request_permission') {
            yield* Queue.offer(
              inbox,
              encoder.encode(
                frame({ _tag: 'Result', id: envelope.id as string, result: { outcome: { outcome: 'selected', optionId: 'allow' } } }),
              ),
            );
          }
          if (envelope.id === 1) yield* Queue.end(inbox);
        }
      }),
      1024 * 1024,
      (outlet) =>
        base({
          prompt: Effect.fnUntraced(function* () {
            yield* Deferred.complete(heard, outlet.request('session/request_permission', { sessionId: 's1' }));
            yield* Effect.exit(Deferred.await(heard));
            return { stopReason: 'end_turn' as const };
          }),
        }),
    );
    expect(yield* Deferred.await(heard)).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
  }),
);

it.effect('a writer that fails ends serving while the client keeps its input open', () =>
  Effect.gen(function* () {
    let ended = false;
    const failure = yield* Effect.flip(
      serve(
        Stream.concat(Stream.make(encoder.encode(frame(request(1, 'initialize', { protocolVersion: 1 })))), Stream.never),
        () => Effect.fail(new ExchangeFailed({ detail: 'stdout closed' })),
        1024 * 1024,
        () =>
          base({
            ended: Effect.sync(() => {
              ended = true;
            }),
          }),
      ),
    );
    expect(failure._tag).toBe('ExchangeFailed');
    expect(ended).toBe(true);
  }),
);
