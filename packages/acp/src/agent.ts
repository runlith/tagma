import { Cause, Data, Deferred, Effect, Exit, Fiber, FiberSet, Queue, Result, Schema, Stream } from 'effect';
import { frame, type Envelope } from '@runlith/ndjson-rpc/envelope';
import { inbound, type ExchangeFailed, type ExchangeOversized } from '@runlith/ndjson-rpc/exchange';
import {
  InitializeParams,
  type InitializeResult,
  LoadSessionParams,
  NewSessionParams,
  type NewSessionResult,
  PromptParams,
  type PromptResult,
  ResumeSessionParams,
  SessionParams,
  type SessionSetup,
  SetSessionConfigOptionParams,
  type SetSessionConfigOptionResult,
  SetSessionModeParams,
} from './methods';
import type { SessionNotification } from './updates';

export const FAULT = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  authRequired: -32000,
  notFound: -32002,
} as const;

export class AgentFault extends Data.TaggedError('AgentFault')<{
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}> {}

type Answer<P, A, R> = (params: P) => Effect.Effect<A, AgentFault, R>;

export type Empty = Readonly<Record<string, never>>;

export type AgentHandlers<R> = {
  readonly initialize: Answer<InitializeParams, InitializeResult, R>;
  readonly newSession: Answer<NewSessionParams, NewSessionResult, R>;
  readonly loadSession?: Answer<LoadSessionParams, SessionSetup, R>;
  readonly resumeSession?: Answer<ResumeSessionParams, SessionSetup, R>;
  readonly prompt: Answer<PromptParams, PromptResult, R>;
  readonly configure?: Answer<SetSessionConfigOptionParams, SetSessionConfigOptionResult, R>;
  readonly setMode?: Answer<SetSessionModeParams, Empty, R>;
  readonly close?: Answer<SessionParams, Empty, R>;
  readonly cancel: (params: SessionParams) => Effect.Effect<void, never, R>;
  readonly extensions: Readonly<Record<string, Answer<unknown, unknown, R>>>;
  readonly ended: Effect.Effect<void, never, R>;
};

export type Outlet = {
  readonly update: (notification: SessionNotification) => Effect.Effect<void>;
  readonly notify: (method: string, params: unknown) => Effect.Effect<void>;
  readonly request: (method: string, params: unknown) => Effect.Effect<unknown, AgentFault>;
};

const SERVING_ENDED = new AgentFault({ code: FAULT.internal, message: 'the client connection closed before it answered' });

type Routed<R> = (handlers: AgentHandlers<R>, params: unknown) => Effect.Effect<unknown, AgentFault, R> | null;

const invalid = (method: string, issue: unknown): AgentFault =>
  new AgentFault({ code: FAULT.invalidParams, message: `${method} params do not match ACP v1: ${String(issue)}` });

const route = <P, R>(
  method: string,
  schema: Schema.Codec<P, unknown>,
  pick: (handlers: AgentHandlers<R>) => Answer<P, unknown, R> | undefined,
): Routed<R> => {
  const decode = Schema.decodeUnknownResult(schema);
  return (handlers, params) => {
    const handler = pick(handlers);
    if (handler === undefined) return null;
    const decoded = decode(params ?? {});
    return Result.isFailure(decoded) ? Effect.fail(invalid(method, decoded.failure)) : handler(decoded.success);
  };
};

const routes = <R>(): Readonly<Record<string, Routed<R>>> => ({
  initialize: route('initialize', InitializeParams, (handlers) => handlers.initialize),
  'session/new': route('session/new', NewSessionParams, (handlers) => handlers.newSession),
  'session/load': route('session/load', LoadSessionParams, (handlers) => handlers.loadSession),
  'session/resume': route('session/resume', ResumeSessionParams, (handlers) => handlers.resumeSession),
  'session/prompt': route('session/prompt', PromptParams, (handlers) => handlers.prompt),
  'session/set_config_option': route('session/set_config_option', SetSessionConfigOptionParams, (handlers) => handlers.configure),
  'session/set_mode': route('session/set_mode', SetSessionModeParams, (handlers) => handlers.setMode),
  'session/close': route('session/close', SessionParams, (handlers) => handlers.close),
});

const decodeCancel = Schema.decodeUnknownResult(SessionParams);

const answered = (id: string | number, exit: Exit.Exit<unknown, AgentFault>): Envelope | null => {
  if (Exit.isSuccess(exit)) return { _tag: 'Result', id, result: exit.value ?? {} };
  if (Cause.hasInterruptsOnly(exit.cause)) return null;
  const fault = Cause.findError(exit.cause);
  if (Result.isSuccess(fault)) {
    const { code, message, data } = fault.success;
    return { _tag: 'Error', id, error: data === undefined ? { code, message } : { code, message, data } };
  }
  return { _tag: 'Error', id, error: { code: FAULT.internal, message: Cause.pretty(exit.cause) } };
};

export const serve = <R>(
  input: Stream.Stream<Uint8Array, ExchangeFailed>,
  write: (bytes: Uint8Array) => Effect.Effect<void, ExchangeFailed>,
  ceiling: number,
  agent: (outlet: Outlet) => AgentHandlers<R>,
): Effect.Effect<void, ExchangeFailed | ExchangeOversized, R> =>
  Effect.scoped(
    Effect.gen(function* () {
      const encoder = new TextEncoder();
      const outgoing = yield* Queue.unbounded<Envelope, Cause.Done>();
      const send = (envelope: Envelope) => Effect.asVoid(Queue.offer(outgoing, envelope));
      const writer = yield* Effect.forkScoped(
        Stream.runForEach(Stream.fromQueue(outgoing), (envelope) => write(encoder.encode(frame(envelope)))),
      );
      const pending = new Map<string | number, Deferred.Deferred<unknown, AgentFault>>();
      let asked = 0;
      let open = true;
      const request = (method: string, params: unknown): Effect.Effect<unknown, AgentFault> =>
        Effect.suspend(() => {
          if (!open) return Effect.fail(SERVING_ENDED);
          asked += 1;
          const id = `agent:${asked}`;
          const answer = Deferred.makeUnsafe<unknown, AgentFault>();
          pending.set(id, answer);
          return Effect.andThen(send({ _tag: 'Request', id, method, params }), Deferred.await(answer)).pipe(
            Effect.ensuring(Effect.sync(() => pending.delete(id))),
          );
        });
      const settled = (id: string | number | null, exit: Exit.Exit<unknown, AgentFault>) =>
        Effect.sync(() => {
          const answer = id === null ? undefined : pending.get(id);
          if (answer !== undefined) Deferred.doneUnsafe(answer, exit);
        });
      const closed = Effect.sync(() => {
        open = false;
        for (const answer of pending.values()) Deferred.doneUnsafe(answer, Exit.fail(SERVING_ENDED));
        pending.clear();
      });
      const handlers = agent({
        update: (notification) => send({ _tag: 'Notification', method: 'session/update', params: notification }),
        notify: (method, params) => send({ _tag: 'Notification', method, params }),
        request,
      });
      const table = routes<R>();
      const working = yield* FiberSet.make<void, never>();
      const requested = (id: string | number, method: string, params: unknown) => {
        const routed = Object.hasOwn(table, method) ? table[method]!(handlers, params) : null;
        const extension =
          method.startsWith('_') && Object.hasOwn(handlers.extensions, method) ? handlers.extensions[method]!(params) : null;
        const work =
          routed ??
          extension ??
          Effect.fail(new AgentFault({ code: FAULT.methodNotFound, message: `this agent does not answer ${method}` }));
        return FiberSet.run(
          working,
          Effect.flatMap(Effect.exit(work), (exit) => {
            const envelope = answered(id, exit);
            return envelope === null ? Effect.void : send(envelope);
          }),
        );
      };
      const notified = (method: string, params: unknown) => {
        if (method !== 'session/cancel') return Effect.void;
        const decoded = decodeCancel(params ?? {});
        return Result.isFailure(decoded) ? Effect.void : Effect.asVoid(FiberSet.run(working, handlers.cancel(decoded.success)));
      };
      const served = Stream.runForEach(
        inbound(() => input, { offset: 0n, torn: false }, ceiling),
        ({ message }) => {
          switch (message._tag) {
            case 'Request':
              return Effect.asVoid(requested(message.id, message.method, message.params));
            case 'Notification':
              return notified(message.method, message.params);
            case 'Malformed':
              return send({ _tag: 'Error', id: null, error: { code: FAULT.parse, message: message.problem, data: message.excerpt } });
            case 'Result':
              return settled(message.id, Exit.succeed(message.result));
            case 'Error':
              return settled(message.id, Exit.fail(new AgentFault(message.error)));
          }
        },
      );
      yield* Effect.raceFirst(served, Effect.andThen(Fiber.join(writer), Effect.never)).pipe(
        Effect.ensuring(Effect.andThen(closed, Effect.andThen(FiberSet.clear(working), handlers.ended))),
      );
      yield* Queue.end(outgoing);
      yield* Fiber.join(writer);
    }),
  );
