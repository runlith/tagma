import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { Cause, Clock, Deferred, Effect, Exit, Fiber, FileSystem, Schema, Stream } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import { openHost, type HostInput } from '../host.js';
import { isSessionNotFoundError, isUnauthorizedError, type OpenCodeEvent, type SessionStructuredError } from '@opencode/client';
import { modelSelection } from '../selection.js';
import { familyRetries, type WireFailureFamily } from '@runlith/llm/schema/errors';
import type { TransportFailure } from '@runlith/agent/transcript/entries';
import { MEASURED, RETRYING } from '@runlith/hosted-runner/wire/extensions';
import type { Process } from '@runlith/hosted-runner/cycle';
import type { Relayed } from '@runlith/hosted-runner/relay';
import { OpenCodeSdk, type Outcome, type Run, type Sending } from './channel.js';
import { preparation } from './plugin.js';
import source from './plugin.ts' with { type: 'text' };

export type Home = { readonly directory: string; readonly host: HostInput };
const Callback = Schema.Struct({
  sessionID: Schema.String,
  messageID: Schema.String,
  id: Schema.String.check(Schema.isMinLength(1)),
  name: Schema.String.check(Schema.isMinLength(1)),
  input: Schema.Unknown,
});
const failed = (cause: unknown): AgentFault =>
  cause instanceof AgentFault
    ? cause
    : new AgentFault({
        code: isSessionNotFoundError(cause) ? FAULT.notFound : isUnauthorizedError(cause) ? FAULT.authRequired : FAULT.internal,
        message:
          cause instanceof Error
            ? cause.message
            : typeof cause === 'object' && cause !== null && 'message' in cause
              ? String(cause.message)
              : String(cause),
      });
const classified = (error: SessionStructuredError, modelStarted: boolean): TransportFailure => {
  const family: WireFailureFamily =
    error.status === 401 || error.status === 403
      ? 'auth'
      : error.status === 429
        ? 'rate-limit'
        : error.status === 404
          ? 'no-route'
          : error.status !== undefined && error.status >= 500
            ? 'overloaded'
            : /context|overflow/i.test(error.type)
              ? 'invalid-request'
              : /auth/i.test(error.type)
                ? 'auth'
                : /network|connect|transport/i.test(error.type)
                  ? 'connect-timeout'
                  : 'unknown';
  return {
    stage: 'opencode.turn',
    type: error.type,
    httpStatus: error.status,
    retryable: familyRetries(family),
    modelStarted,
    reason: { family, status: error.status },
  };
};
const promptOf = (blocks: Sending['blocks']) => {
  let text = '';
  const files: { uri: string; name: string; mention: { start: number; end: number; text: string } }[] = [];
  for (const block of blocks) {
    if (text.length > 0) text += '\n\n';
    if (block.type === 'text') text += block.text;
    else if (block.type === 'image') {
      const name = `tagma-image-${randomUUID()}`;
      const marker = `<${name}>`;
      files.push({
        uri: `data:${block.mimeType};base64,${block.data}`,
        name,
        mention: { start: text.length, end: text.length + marker.length, text: marker },
      });
      text += marker;
    } else throw new Error(`OpenCode cannot receive ${block.type} content`);
  }
  return { text, files };
};

type Active = {
  readonly id: string;
  readonly input: Sending;
  readonly names: ReadonlySet<string>;
  readonly returned: Map<string, Relayed>;
};

export const makeOpenCodeSdk = Effect.fn('opencode.makeSdk')(function* (home: Home, process: Process) {
  const files = yield* FileSystem.FileSystem;
  const scope = yield* Effect.scope;
  const context = yield* Effect.context<never>();
  const runEffect = Effect.runPromiseWith(context);
  const secret = randomUUID();
  let active: Active | null = null;
  const callback = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        idleTimeout: 0,
        fetch: async (request) => {
          if (request.method !== 'POST' || new URL(request.url).pathname !== '/call') return new Response('Not found', { status: 404 });
          if (request.headers.get('authorization') !== `Bearer ${secret}`)
            return new Response('Invalid callback credentials', { status: 401 });
          return runEffect(
            Effect.gen(function* () {
              const body = yield* Effect.tryPromise({ try: () => request.json(), catch: failed }).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(Callback)),
                Effect.mapError(failed),
              );
              const running = active;
              if (running === null || running.id !== body.sessionID || !running.names.has(body.name))
                return new Response('No prepared hosted call', { status: 409 });
              const answer = yield* running.input.call(body.id, body.name, body.input);
              running.returned.set(body.id, answer);
              if (answer.failed)
                return new Response(
                  answer.content
                    .filter((part) => part.type === 'text')
                    .map((part) => part.text)
                    .join('\n'),
                  { status: 422 },
                );
              return Response.json(
                answer.content.map((part) =>
                  part.type === 'text' ? part : { type: 'file', uri: `data:${part.mimeType};base64,${part.data}`, mime: part.mimeType },
                ),
              );
            }),
            { signal: request.signal },
          );
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  );
  const plugin = join(home.directory, 'plugin');
  yield* files.makeDirectory(plugin, { recursive: true }).pipe(Effect.mapError(failed));
  yield* files.writeFileString(join(plugin, 'index.ts'), source as unknown as string).pipe(Effect.mapError(failed));
  yield* files
    .writeFileString(join(plugin, 'package.json'), JSON.stringify({ type: 'module', exports: { './server': './index.ts' } }))
    .pipe(Effect.mapError(failed));
  const config = yield* Effect.try({ try: () => JSON.parse(home.host.config.content) as unknown, catch: failed }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Json))),
    Effect.mapError(failed),
  );
  const host = yield* openHost({
    ...home.host,
    config: {
      ...home.host.config,
      content: JSON.stringify({
        ...config,
        snapshots: false,
        formatter: false,
        lsp: false,
        share: 'disabled',
        update: 'disable',
        warming: false,
        compaction: { auto: false },
        plugins: [{ package: plugin, options: { endpoint: `http://127.0.0.1:${callback.port}/call`, secret } }],
      }),
    },
  }).pipe(Effect.mapError(failed));
  yield* Effect.forkScoped(
    Effect.matchEffect(host.exit, {
      onSuccess: (code) => process.died(`OpenCode private host exited (${code})`),
      onFailure: (cause) => process.died(cause.message),
    }),
  );
  const client = host.client;
  const readySession = Effect.fn('opencode.load')(function* (id: string, cwd: string) {
    const session = yield* Effect.tryPromise({ try: () => client.session.get({ sessionID: id }), catch: failed });
    if (session.id !== id || resolve(session.location.directory, session.subpath ?? '.') !== resolve(cwd))
      return yield* new AgentFault({ code: FAULT.notFound, message: `OpenCode session ${id} belongs to another directory` });
    const tail = yield* Effect.tryPromise({ try: () => client.message.list({ sessionID: id, limit: 1, order: 'desc' }), catch: failed });
    const terminal = tail.data.length === 0 || tail.data[0]?.type === 'idle';
    const inbox = yield* Effect.tryPromise({ try: () => client.session.inbox.list({ sessionID: id }), catch: failed });
    if (!terminal || inbox.length > 0)
      return yield* new AgentFault({
        code: FAULT.notFound,
        message: `OpenCode session ${id} has an unfinished execution or undelivered input; restore it from the Tagma journal`,
      });
  });
  return OpenCodeSdk.of({
    open: Effect.fn('OpenCodeSdk.open')(function* (opening, replacing) {
      if (opening.id !== null) yield* readySession(opening.id, opening.cwd);
      yield* replacing;
      const id =
        opening.id ??
        (yield* Effect.tryPromise({ try: () => client.session.create({ location: { directory: opening.cwd } }), catch: failed })).id;
      let run: Run | null = null;
      const close = Effect.fnUntraced(function* () {
        if (run !== null) {
          yield* run.cancel.pipe(Effect.orDie);
          yield* run.wait.pipe(Effect.orDie);
        }
      });
      return {
        id,
        close: close(),
        send: Effect.fn('OpenCodeSdk.send')(function* (input) {
          if (active !== null) return yield* new AgentFault({ code: FAULT.invalidRequest, message: 'OpenCode already has an active turn' });
          const selection = yield* Effect.try({ try: () => modelSelection(input.selection.model, input.selection.effort), catch: failed });
          const prompt = yield* Effect.try({ try: () => promptOf(input.blocks), catch: failed });
          const tools = yield* Effect.forEach(input.tools, (tool) =>
            Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Json))(tool.inputSchema).pipe(
              Effect.map((inputSchema) => ({ name: tool.name, description: tool.description, inputSchema })),
              Effect.mapError(failed),
            ),
          );
          const done = yield* Deferred.make<Outcome, AgentFault>();
          const terminal = yield* Deferred.make<Outcome>();
          const connected = yield* Deferred.make<void>();
          const returned = new Map<string, Relayed>();
          const names = new Set(input.tools.map((tool) => tool.name));
          const calls = new Map<string, string>();
          const messages = new Map<string, Set<string>>();
          const sealed = new Set<string>();
          const lengths = new Map<string, number>();
          let cancelled = false;
          let sent = false;
          let modelStarted = false;
          let started = 0;
          let attempt = 0;
          const running: Active = { id, input, names, returned };
          active = running;
          const seal = (messageId: string) =>
            sealed.has(messageId)
              ? Effect.void
              : Effect.andThen(
                  Effect.sync(() => {
                    sealed.add(messageId);
                  }),
                  input.event({ type: 'said', said: { messageId, toolCallIds: [...(messages.get(messageId) ?? [])] } }),
                );
          const event = Effect.fnUntraced(function* (event: OpenCodeEvent) {
            if (event.type === 'server.connected') {
              yield* Deferred.succeed(connected, undefined);
              return;
            }
            if (!('sessionID' in event.data) || event.data.sessionID !== id) return;
            switch (event.type) {
              case 'session.step.started':
                started = event.data.started;
                yield* input.event({ type: 'phase', phase: 'calling' });
                break;
              case 'session.text.started':
                yield* input.event({ type: 'phase', phase: 'writing' });
                break;
              case 'session.reasoning.started':
                yield* input.event({ type: 'phase', phase: 'reasoning' });
                break;
              case 'session.text.delta':
              case 'session.reasoning.delta': {
                modelStarted = true;
                const kind = event.type === 'session.text.delta' ? 'text' : 'thought';
                const key = `${event.data.assistantMessageID}:${kind}:${event.data.ordinal}`;
                lengths.set(key, (lengths.get(key) ?? 0) + event.data.delta.length);
                yield* input.event({ type: kind, messageId: event.data.assistantMessageID, text: event.data.delta });
                break;
              }
              case 'session.text.ended':
              case 'session.reasoning.ended': {
                const kind = event.type === 'session.text.ended' ? 'text' : 'thought';
                const key = `${event.data.assistantMessageID}:${kind}:${event.data.ordinal}`;
                yield* input.event({
                  type: kind,
                  messageId: event.data.assistantMessageID,
                  text: event.data.text.slice(lengths.get(key) ?? 0),
                });
                lengths.delete(key);
                break;
              }
              case 'session.tool.input.started': {
                modelStarted = true;
                const tool = event.data;
                calls.set(tool.id, tool.name);
                const batch = messages.get(tool.assistantMessageID) ?? new Set<string>();
                batch.add(tool.id);
                messages.set(tool.assistantMessageID, batch);
                yield* input.event({ type: 'phase', phase: 'tools' });
                yield* input.event({
                  type: 'call',
                  hosted: names.has(tool.name),
                  call: { toolCallId: tool.id, title: tool.name, name: tool.name, status: 'pending', rawInput: {} },
                });
                break;
              }
              case 'session.tool.input.delta': {
                const name = calls.get(event.data.id);
                if (name === undefined)
                  return yield* new AgentFault({ code: FAULT.internal, message: `OpenCode sent input for unknown call ${event.data.id}` });
                yield* input.event({ type: 'input', toolCallId: event.data.id, name, delta: event.data.delta });
                break;
              }
              case 'session.tool.called':
                yield* input.event({ type: 'result', hosted: false, result: { toolCallId: event.data.id, rawInput: event.data.input } });
                break;
              case 'session.step.streamed':
                yield* seal(event.data.assistantMessageID);
                break;
              case 'session.tool.success':
              case 'session.tool.failed': {
                const answer = returned.get(event.data.id);
                returned.delete(event.data.id);
                const name = calls.get(event.data.id);
                if (name === undefined)
                  return yield* new AgentFault({ code: FAULT.internal, message: `OpenCode answered unknown call ${event.data.id}` });
                const hosted = names.has(name);
                const content = answer?.content ?? [
                  {
                    type: 'text' as const,
                    text: event.type === 'session.tool.failed' ? event.data.error.message : JSON.stringify(event.data.content),
                  },
                ];
                yield* input.event({
                  type: 'result',
                  hosted,
                  result: {
                    toolCallId: event.data.id,
                    status: answer?.failed === true || event.type === 'session.tool.failed' ? 'failed' : 'completed',
                    content: content.map((part) => ({ type: 'content' as const, content: part })),
                    rawOutput: answer ?? event.data,
                  },
                });
                break;
              }
              case 'session.step.ended':
              case 'session.step.failed': {
                yield* seal(event.data.assistantMessageID);
                const tokens = event.data.tokens;
                if (tokens !== undefined) {
                  const inputTokens = tokens.input + tokens.cache.read + tokens.cache.write;
                  const outputTokens = tokens.output + tokens.reasoning;
                  const sentAt = new Date(started || (yield* Clock.currentTimeMillis)).toISOString();
                  yield* input.event({
                    type: 'usage',
                    update: {
                      sessionUpdate: 'usage_update',
                      used: inputTokens + outputTokens,
                      size: 0,
                      _meta: {
                        [MEASURED]: {
                          message: event.data.assistantMessageID,
                          sentAt,
                          input: inputTokens,
                          output: outputTokens,
                          reasoning: tokens.reasoning,
                          cacheRead: tokens.cache.read,
                          cacheWrite: tokens.cache.write,
                          ttlSeconds: null,
                          attempt,
                        },
                      },
                    },
                  });
                }
                yield* input.event({ type: 'phase', phase: 'calling' });
                attempt = 0;
                break;
              }
              case 'session.retry.scheduled': {
                attempt = event.data.attempt;
                yield* input.event({ type: 'phase', phase: 'retrying' });
                yield* input.event({
                  type: 'notification',
                  method: RETRYING,
                  fields: {
                    uuid: event.id,
                    attempt,
                    of: 0,
                    delayMs: Math.max(0, event.data.at - (yield* Clock.currentTimeMillis)),
                    family: classified(event.data.error, modelStarted).reason?.family ?? 'unknown',
                    httpStatus: event.data.error.status ?? null,
                    message: event.data.error.message,
                  },
                });
                break;
              }
              case 'session.execution.succeeded':
                yield* Deferred.succeed(terminal, { status: 'finished' });
                break;
              case 'session.execution.interrupted':
                yield* Deferred.succeed(terminal, { status: 'cancelled' });
                break;
              case 'session.execution.failed':
                yield* Deferred.succeed(terminal, {
                  status: 'error',
                  detail: event.data.error.message,
                  failure: classified(event.data.error, modelStarted),
                });
                break;
            }
          });
          const work = Effect.scoped(
            Effect.gen(function* () {
              const controller = yield* Effect.acquireRelease(
                Effect.sync(() => new AbortController()),
                (controller) => Effect.sync(() => controller.abort()),
              );
              const reader = Stream.runForEach(
                Stream.fromAsyncIterable(client.event.subscribe({ signal: controller.signal }), failed),
                event,
              ).pipe(
                Effect.andThen(
                  Effect.fail(new AgentFault({ code: FAULT.internal, message: 'The OpenCode event stream ended during a turn' })),
                ),
              );
              const events = yield* Effect.forkScoped(reader);
              yield* Effect.raceFirst(Deferred.await(connected), Fiber.join(events));
              yield* Effect.tryPromise({
                try: () =>
                  client.rpc(preparation).prepare({ sessionID: id, system: input.system, tools }, { location: { directory: opening.cwd } }),
                catch: failed,
              });
              yield* Effect.tryPromise({ try: () => client.session.switchModel({ sessionID: id, model: selection }), catch: failed });
              if (cancelled) return { status: 'cancelled' as const };
              yield* input.event({ type: 'phase', phase: 'calling' });
              sent = true;
              yield* Effect.tryPromise({ try: () => client.session.prompt({ sessionID: id, ...prompt }), catch: failed });
              yield* input.taken;
              if (cancelled) yield* Effect.tryPromise({ try: () => client.session.interrupt({ sessionID: id }), catch: failed });
              yield* Effect.tryPromise({ try: () => client.session.wait({ sessionID: id }), catch: failed });
              return yield* Effect.raceFirst(Deferred.await(terminal), Fiber.join(events));
            }),
          );
          yield* Effect.forkIn(
            Effect.gen(function* () {
              const exit = yield* Effect.exit(work);
              if (active === running) active = null;
              run = null;
              yield* Deferred.done(done, exit);
              if (Exit.isFailure(exit)) yield* process.died(Cause.pretty(exit.cause));
            }),
            scope,
          );
          const sending: Run = {
            wait: Deferred.await(done),
            cancel: Effect.gen(function* () {
              cancelled = true;
              if (sent && !(yield* Deferred.isDone(done))) {
                yield* Effect.tryPromise({ try: () => client.session.interrupt({ sessionID: id }), catch: failed });
                yield* Deferred.await(done);
              }
            }).pipe(Effect.withSpan('OpenCodeSdk.cancel')),
          };
          run = sending;
          return sending;
        }),
      };
    }),
  });
});
