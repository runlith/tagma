import { Effect, Predicate, Queue } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import { MuseRefused, MuseSdk, type Frame, type Host } from './channel.js';

type Module = typeof import('@muse-code/sdk');

const SHUTDOWN_MS = 10_000;

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
      yield* Effect.forkScoped(Effect.forever(Effect.flatMap(Queue.take(frames), launch.frame)));
      const connection = spawned.connection;
      return {
        home: started.museHome,
        command: (method, params, commandId) =>
          Effect.tryPromise({
            try: () => connection.command(method, params, commandId === undefined ? { maxAttempts: 1 } : { maxAttempts: 1, commandId }),
            catch: refused(method),
          }),
        request: (method, params) => Effect.tryPromise({ try: () => connection.request(method, params), catch: refused(method) }),
        mint: () => connection.mintCommandId(),
        ended: Effect.map(
          Effect.promise(() => spawned.exited),
          (exit) => `${exitOf(exit)}${spawned.child.stderrTail.length === 0 ? '' : `: ${spawned.child.stderrTail.join('\n')}`}`,
        ),
      } satisfies Host;
    }),
  });
};

export const loadMuseSdk: Effect.Effect<MuseSdk['Service']> = Effect.map(
  Effect.promise(() => import('@muse-code/sdk')),
  museSdk,
);
