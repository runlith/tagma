import { Deferred, Effect, Predicate, Queue } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import { MuseRefused, MuseSdk, type Frame, type Host } from './channel.js';

type Module = typeof import('@muse-code/sdk');

const SHUTDOWN_MS = 10_000;

const PAGE = 1000;

const ATTEMPTS = 3;

const cursorOf = (frame: Frame): string | undefined => (typeof frame.params.viewCursor === 'string' ? frame.params.viewCursor : undefined);

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

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
      const frames = yield* Queue.unbounded<Frame>();
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
      yield* Effect.addFinalizer(() => Effect.asVoid(Effect.promise(() => handshake.close())));
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
      const paged = new Set<string>();
      const page = (sessionId: string, cursor: string) =>
        Effect.tryPromise({
          try: () => connection.request('view/page', { sessionId, cursor, direction: 'forward', limit: PAGE }),
          catch: refused('view/page'),
        });
      const recover = Effect.fnUntraced(function* (sessionId: string, after: string, next: string) {
        paged.clear();
        let cursor = after;
        for (;;) {
          const served = objectOf(yield* page(sessionId, cursor));
          const events = Array.isArray(served.events) ? served.events : [];
          for (const event of events) {
            const shaped = objectOf(event);
            const frame: Frame = { method: text(shaped.method) ?? '', params: objectOf(shaped.params), request: false };
            const at = cursorOf(frame);
            if (at === undefined || at === next) return;
            paged.add(at);
            cursor = at;
            yield* launch.frame(frame);
          }
          if (events.length === 0 || text(served.nextCursor) === undefined) return;
        }
      });
      const deliver = Effect.fnUntraced(function* (frame: Frame) {
        if (frame.method !== 'view/gap') {
          const at = cursorOf(frame);
          if (at !== undefined && paged.delete(at)) return;
          return yield* launch.frame(frame);
        }
        const { sessionId, after, next } = frame.params;
        if (typeof sessionId !== 'string' || typeof after !== 'string' || typeof next !== 'string') return;
        yield* recover(sessionId, after, next).pipe(
          Effect.catchTag('MuseRefused', (refusal) =>
            Deferred.succeed(lost, `Muse Code dropped events of session ${sessionId} and could not page them back: ${refusal.message}`),
          ),
        );
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
