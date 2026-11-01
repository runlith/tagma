import { Data, Deferred, Effect, Option, Predicate, Queue } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import { MuseRefused, MuseSdk, type Frame, type Host } from './channel.js';

type Module = typeof import('@muse-code/sdk');

const SHUTDOWN_MS = 10_000;

const PAGE = 1000;

const ATTEMPTS = 3;

const cursorOf = (frame: Frame): string | undefined => (typeof frame.params.viewCursor === 'string' ? frame.params.viewCursor : undefined);

const durable = (frame: Frame): boolean => frame.params.sourceRange !== undefined;

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

type Barrier = { readonly reached: Deferred.Deferred<void> };

class Unpaged extends Data.TaggedError('Unpaged')<{ readonly message: string }> {}

const exitOf = (exit: { readonly code: number | null; readonly signal: string | null }): string =>
  exit.signal === null ? `muse serve exited with code ${exit.code}` : `muse serve ended by ${exit.signal}`;

const objectOf = (value: unknown): Readonly<Record<string, unknown>> => (Predicate.isObject(value) ? value : {});

const museSdk = (module: Module): MuseSdk['Service'] => {
  const refused = (method: string) => (cause: unknown) =>
    cause instanceof module.MspError
      ? new MuseRefused({ method, kind: cause.kind, code: cause.code, message: cause.message })
      : new MuseRefused({
          method,
          kind: 'transport',
          code: FAULT.internal,
          message: cause instanceof Error ? cause.message : String(cause),
        });
  return MuseSdk.of({
    open: Effect.fn('MuseSdk.open')(function* (launch) {
      const frames = yield* Queue.unbounded<Frame | Barrier>();
      const closing = yield* Deferred.make<void>();
      const handshake = module.spawnMspConnection({
        command: launch.program,
        args: [...launch.args],
        cwd: launch.cwd,
        env: { ...launch.env },
        onStderr: launch.stderr,
        shutdownTimeoutMs: SHUTDOWN_MS,
      });
      handshake.onNotification((note) => {
        Queue.offerUnsafe(frames, { method: note.method, params: objectOf(note.params), request: false });
      });
      handshake.onServerRequest(async (asked) => {
        Queue.offerUnsafe(frames, { method: asked.method, params: objectOf(asked.params), request: true });
        return {};
      });
      handshake.onProtocolError((error) => launch.stderr(`Muse Code sent a frame the SDK refused: ${error.message}\n`));
      yield* Effect.addFinalizer(() =>
        Effect.andThen(
          Deferred.succeed(closing, undefined),
          Effect.promise(() => handshake.close()),
        ),
      );
      const spawned = yield* Effect.tryPromise({
        try: () =>
          handshake.initialize({
            clientInfo: { name: 'tagma', title: 'Tagma', version: '1' },
            capabilities: { requestedCapabilities: launch.sessionMcp ? ['sessionMcp'] : [] },
          }),
        catch: (cause) =>
          new AgentFault({
            code: FAULT.internal,
            message: `muse serve did not start: ${cause instanceof Error ? cause.message : String(cause)}\n${handshake.child.stderrTail.join('\n')}`,
          }),
      });
      const started = spawned.initializeResult;
      if (started.schema.version !== 1)
        return yield* new AgentFault({
          code: FAULT.internal,
          message: `Muse Code ${started.serverInfo.version} speaks MSP envelope ${started.schema.version}; this runner reads only version 1`,
        });
      if (launch.sessionMcp && !started.grantedCapabilities.includes('sessionMcp'))
        return yield* new AgentFault({
          code: FAULT.internal,
          message: `Muse Code ${started.serverInfo.version} did not grant session MCP servers, so Tagma's tools cannot reach it`,
        });
      const connection = spawned.connection;
      const tail = () => (spawned.child.stderrTail.length === 0 ? '' : `: ${spawned.child.stderrTail.join('\n')}`);
      const lost = yield* Deferred.make<string>();
      const seen = new Map<string, Set<string>>();
      const twins = new Set<string>();
      const page = (sessionId: string, cursor: string) =>
        Effect.tryPromise({
          try: () => connection.request('view/page', { sessionId, cursor, direction: 'forward', limit: PAGE }),
          catch: refused('view/page'),
        });
      const pass = Effect.fnUntraced(function* (frame: Frame) {
        const at = cursorOf(frame);
        const session = text(frame.params.sessionId);
        if (at !== undefined && session !== undefined && durable(frame)) {
          const standing = frame.method === 'turn/started' ? undefined : seen.get(session);
          const held = standing ?? new Set<string>();
          if (standing === undefined) seen.set(session, held);
          held.add(at);
        }
        yield* launch.frame(frame);
      });
      const hole = Effect.fnUntraced(function* (
        sessionId: string,
        after: string,
        next: string,
        hold: Effect.Effect<void>,
        arrived: ReadonlySet<string>,
      ) {
        const known = seen.get(sessionId) ?? new Set<string>();
        const missed: Frame[] = [];
        let cursor = after;
        for (;;) {
          yield* hold;
          const served = objectOf(yield* page(sessionId, cursor));
          const { events, nextCursor } = served;
          if (!Array.isArray(events) || (nextCursor !== null && typeof nextCursor !== 'string'))
            return yield* new Unpaged({ message: `view/page answered in an unreadable shape after ${cursor}` });
          for (const event of events) {
            const shaped = objectOf(event);
            const frame: Frame = { method: text(shaped.method) ?? '', params: objectOf(shaped.params), request: false };
            const at = cursorOf(frame);
            if (at === undefined) return yield* new Unpaged({ message: `view/page served an event with no cursor after ${cursor}` });
            if (at === next || known.has(at) || arrived.has(at)) return { missed, bounded: true };
            missed.push(frame);
          }
          if (nextCursor === null) return { missed, bounded: false };
          if (events.length === 0 || nextCursor === cursor)
            return yield* new Unpaged({ message: `view/page made no progress after ${cursor}` });
          cursor = nextCursor;
        }
      });
      const unpaged = (sessionId: string, reason: string) =>
        Deferred.succeed(lost, `Muse Code dropped events of session ${sessionId} and could not page them back: ${reason}`);
      const fill = Effect.fnUntraced(function* (sessionId: string, after: string, next: string) {
        const held: (Frame | Barrier)[] = [];
        const arrived = new Set<string>();
        const hold = Effect.map(Queue.clear(frames), (taken) => {
          for (const item of taken) {
            held.push(item);
            const at = 'reached' in item ? undefined : cursorOf(item);
            if (at !== undefined) arrived.add(at);
          }
        });
        const walked = yield* hole(sessionId, after, next, hold, arrived).pipe(
          Effect.map(Option.some),
          Effect.catchTags({
            MuseRefused: (refusal) => Effect.as(unpaged(sessionId, refusal.message), Option.none()),
            Unpaged: (refusal) => Effect.as(unpaged(sessionId, refusal.message), Option.none()),
          }),
        );
        if (Option.isSome(walked))
          for (const frame of walked.value.missed) {
            const at = cursorOf(frame);
            if (!walked.value.bounded && at !== undefined) twins.add(at);
            yield* pass(frame);
          }
        yield* hold;
        for (const item of held) yield* deliver(item);
      });
      const deliver = Effect.fnUntraced(function* (taken: Frame | Barrier): Effect.fn.Return<void> {
        if ('reached' in taken) {
          yield* Deferred.succeed(taken.reached, undefined);
          return;
        }
        if (taken.method !== 'view/gap') {
          const at = cursorOf(taken);
          if (at !== undefined && twins.delete(at)) return;
          return yield* pass(taken);
        }
        const { sessionId, after, next } = taken.params;
        if (typeof sessionId === 'string' && typeof after === 'string' && typeof next === 'string')
          return yield* fill(sessionId, after, next);
        yield* Deferred.succeed(lost, `Muse Code reported dropped events in an unreadable view/gap: ${JSON.stringify(taken.params)}`);
      });
      yield* Effect.forkScoped(Effect.forever(Effect.flatMap(Queue.take(frames), deliver)));
      return {
        home: started.museHome,
        command: (method, params, commandId) =>
          Effect.tryPromise({
            try: () => connection.command(method, params, { maxAttempts: ATTEMPTS, commandId: commandId ?? connection.mintCommandId() }),
            catch: refused(method),
          }).pipe(Effect.withSpan('MuseSdk.command', { attributes: { method } })),
        request: (method, params) =>
          Effect.tryPromise({ try: () => connection.request(method, params), catch: refused(method) }).pipe(
            Effect.withSpan('MuseSdk.request', { attributes: { method } }),
          ),
        mint: () => connection.mintCommandId(),
        drained: Effect.gen(function* () {
          const reached = yield* Deferred.make<void>();
          yield* Queue.offer(frames, { reached });
          yield* Effect.raceFirst(Deferred.await(reached), Deferred.await(closing));
        }),
        ended: Effect.raceAll([
          Effect.map(
            Effect.promise(() => spawned.exited),
            (exit) => `${exitOf(exit)}${tail()}`,
          ),
          Effect.map(
            Effect.promise(() => connection.closed.then(undefined, () => undefined)),
            () => `muse serve closed its MSP connection${tail()}`,
          ),
          Deferred.await(lost),
        ]),
      } satisfies Host;
    }),
  });
};

export const loadMuseSdk: Effect.Effect<MuseSdk['Service']> = Effect.map(
  Effect.promise(() => import('@muse-code/sdk')),
  museSdk,
);
