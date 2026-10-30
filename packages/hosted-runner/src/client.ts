import { Cause, Deferred, Effect, Exit, type Scope } from 'effect';
import { AgentFault, FAULT, type Outlet } from '@runlith/acp/agent';
import type { PromptResult } from '@runlith/acp/methods';
import type { SessionConfigOption } from '@runlith/acp/updates';
import type { TransportFailure } from '@runlith/agent/transcript/entries';
import type { Input, Prepared, Process, Session } from './cycle.js';
import type { HostedDoor } from './door.js';
import { Handed } from './handed.js';
import { Output } from './output.js';
import { Relay } from './relay.js';

export type ClientOutcome = {
  readonly status: 'finished' | 'cancelled' | 'error';
  readonly usage?: PromptResult['usage'];
  readonly failure?: TransportFailure;
  readonly detail?: string;
};

export interface ClientRun {
  readonly wait: Effect.Effect<ClientOutcome, AgentFault>;
  readonly cancel: Effect.Effect<void, AgentFault>;
}

export type ClientSending = {
  readonly input: Input;
  readonly prepared: Prepared;
  readonly output: Output;
  readonly relay: Relay;
  readonly cancelled: () => boolean;
};

export interface ClientDriver {
  readonly id: string;
  readonly cwd: string;
  configOptions(): readonly SessionConfigOption[];
  configure(id: string, value: string): Effect.Effect<readonly SessionConfigOption[], AgentFault>;
  send(sending: ClientSending): Effect.Effect<ClientRun, AgentFault>;
  readonly close: Effect.Effect<void>;
}

type Running = { readonly done: Deferred.Deferred<PromptResult, AgentFault>; run: ClientRun | null; cancelled: boolean };

export const clientSession = Effect.fnUntraced(function* (
  client: ClientDriver,
  door: HostedDoor,
  process: Process,
  outlet: Outlet,
  scope: Scope.Scope,
): Effect.fn.Return<Session> {
  let prepared: Prepared | null = null;
  let current: Running | null = null;
  const handed = new Handed();
  const output = new Output(client.id, outlet, handed);
  const relay = new Relay(door, handed, {
    changed: () => Effect.void,
    queued: () => Effect.void,
    stderr: process.stderr,
    broke: process.died,
  });
  const cancel = Effect.fnUntraced(function* () {
    const running = current;
    if (running === null) return;
    running.cancelled = true;
    if (running.run !== null) yield* running.run.cancel.pipe(Effect.catchTag('AgentFault', (cause) => process.died(cause.message)));
  });
  return {
    id: client.id,
    cwd: client.cwd,
    configOptions: () => client.configOptions(),
    configure: (id, value) => client.configure(id, value),
    busy: () => current !== null,
    prepare: (input) =>
      Effect.sync(() => {
        prepared = input;
      }),
    start: Effect.fnUntraced(function* (input) {
      if (current !== null || prepared === null)
        return yield* new AgentFault({ code: FAULT.invalidRequest, message: 'This agent has no prepared idle turn' });
      const frozen = prepared;
      prepared = null;
      const running: Running = { done: yield* Deferred.make<PromptResult, AgentFault>(), run: null, cancelled: false };
      current = running;
      const work = Effect.gen(function* () {
        if (running.cancelled) return { stopReason: 'cancelled' as const };
        const run = yield* client.send({ input, prepared: frozen, output, relay, cancelled: () => running.cancelled });
        running.run = run;
        if (running.cancelled) yield* run.cancel;
        const outcome = yield* run.wait;
        if (outcome.detail !== undefined) process.stderr(`${outcome.detail}\n`);
        const meta = { 'tagma/turn': { prompt: input.id, last: input.id }, 'tagma/failure': outcome.failure };
        if (outcome.status === 'error' && !running.cancelled)
          return yield* new AgentFault({
            code: outcome.failure?.reason?.family === 'auth' ? FAULT.authRequired : FAULT.internal,
            message: outcome.detail ?? 'The hosted execution failed',
            data: { 'tagma/failure': outcome.failure, usage: outcome.usage, _meta: meta },
          });
        return {
          stopReason: running.cancelled || outcome.status === 'cancelled' ? ('cancelled' as const) : ('end_turn' as const),
          usage: outcome.usage,
          _meta: meta,
        };
      });
      yield* Effect.forkIn(
        Effect.gen(function* () {
          const exit = yield* Effect.exit(work);
          if (current === running) current = null;
          yield* Deferred.done(running.done, exit);
          if (Exit.isFailure(exit) && Cause.hasDies(exit.cause)) yield* process.died(Cause.pretty(exit.cause));
        }),
        scope,
      );
      return Deferred.await(running.done);
    }),
    steer: () => Effect.succeed({ outcome: 'promptRequired' }),
    cancel,
    close: Effect.fnUntraced(function* () {
      const running = current;
      yield* cancel();
      if (running !== null) yield* Deferred.await(running.done).pipe(Effect.orDie);
      yield* client.close;
    }),
  } satisfies Session;
});
