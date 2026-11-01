import { Cause, Deferred, Effect, Exit, type Scope } from 'effect';
import { AgentFault, FAULT, type Outlet } from '@runlith/acp/agent';
import type { ContentBlock } from '@runlith/acp/content';
import type { PromptResult } from '@runlith/acp/methods';
import type { ToolCall } from '@runlith/acp/toolCalls';
import type { SessionConfigOption } from '@runlith/acp/updates';
import type { TransportFailure } from '@runlith/agent/transcript/entries';
import type { Input, Prepared, Process, Session, Steered, Withdrawn } from './cycle.js';
import type { HostedDoor } from './door.js';
import { Handed } from './handed.js';
import { Output } from './output.js';
import { permitted } from './question.js';
import { Relay } from './relay.js';
import { UNSTEPPED } from './wire/extensions.js';

const CANCELLED = -32800;

export type ClientOutcome = {
  readonly status: 'finished' | 'cancelled' | 'error';
  readonly usage?: PromptResult['usage'];
  readonly failure?: TransportFailure;
  readonly detail?: string;
  readonly turn?: string;
};

export interface ClientRun {
  readonly wait: Effect.Effect<ClientOutcome, AgentFault>;
  readonly cancel: Effect.Effect<void, AgentFault>;
  readonly steer?: (prompt: readonly ContentBlock[], input: string | undefined) => Effect.Effect<Steered, AgentFault>;
  readonly withdraw?: (input: string) => Effect.Effect<Withdrawn, AgentFault>;
}

export type ClientSending = {
  readonly input: Input;
  readonly prepared: Prepared;
  readonly output: Output;
  readonly relay: Relay;
  readonly cancelled: () => boolean;
  readonly permitted: (call: ToolCall) => Effect.Effect<string | null>;
};

type ClientCompacted = {
  readonly summary: string;
  readonly preTokens?: number;
  readonly postTokens?: number | null;
  readonly usage?: PromptResult['usage'];
};

interface ClientCompaction {
  readonly wait: Effect.Effect<ClientCompacted, AgentFault>;
  readonly cancel: Effect.Effect<void, AgentFault>;
}

export interface ClientDriver {
  readonly id: string;
  readonly cwd: string;
  configOptions(): readonly SessionConfigOption[];
  configure(id: string, value: string): Effect.Effect<readonly SessionConfigOption[], AgentFault>;
  send(sending: ClientSending): Effect.Effect<ClientRun, AgentFault>;
  readonly handed?: Handed;
  readonly queued?: (words: readonly string[]) => Effect.Effect<void>;
  readonly compact?: (instructions: string, output: Output) => Effect.Effect<ClientCompaction, AgentFault>;
  readonly close: Effect.Effect<void>;
}

type Running = {
  readonly done: Deferred.Deferred<PromptResult, AgentFault>;
  readonly sent: Deferred.Deferred<ClientRun | null>;
  run: ClientRun | null;
  cancelled: boolean;
};

const unsent = () => new AgentFault({ code: CANCELLED, message: 'the turn was cancelled before the agent read these words' });

export const clientSession = Effect.fnUntraced(function* (
  client: ClientDriver,
  door: HostedDoor,
  process: Process,
  outlet: Outlet,
  scope: Scope.Scope,
): Effect.fn.Return<Session> {
  let prepared: Prepared | null = null;
  let current: Running | null = null;
  let compacting: ClientCompaction | null = null;
  const handed = client.handed ?? new Handed();
  const output = new Output(client.id, outlet, handed);
  const relay = new Relay(door, handed, {
    changed: () => Effect.void,
    queued: client.queued ?? (() => Effect.void),
    stderr: process.stderr,
    broke: process.died,
  });
  const ask = (call: ToolCall) => permitted(outlet, client.id, call);
  const sentRun = Effect.fnUntraced(function* () {
    const running = current;
    if (running === null) return null;
    const run = yield* Deferred.await(running.sent);
    if (run === null && running.cancelled) return yield* unsent();
    return run;
  });
  const cancel = Effect.fnUntraced(function* () {
    const stopping = compacting;
    if (stopping !== null) yield* stopping.cancel.pipe(Effect.catchTag('AgentFault', (cause) => process.died(cause.message)));
    const running = current;
    if (running === null) return;
    running.cancelled = true;
    if (running.run !== null) yield* running.run.cancel.pipe(Effect.catchTag('AgentFault', (cause) => process.died(cause.message)));
  });
  const compact = client.compact;
  return {
    id: client.id,
    cwd: client.cwd,
    configOptions: () => client.configOptions(),
    configure: (id, value) => client.configure(id, value),
    busy: () => current !== null || compacting !== null,
    prepare: (input) =>
      Effect.sync(() => {
        prepared = input;
      }),
    start: Effect.fnUntraced(function* (input) {
      if (current !== null || compacting !== null || prepared === null)
        return yield* new AgentFault({ code: FAULT.invalidRequest, message: 'This agent has no prepared idle turn' });
      const frozen = prepared;
      prepared = null;
      const running: Running = {
        done: yield* Deferred.make<PromptResult, AgentFault>(),
        sent: yield* Deferred.make<ClientRun | null>(),
        run: null,
        cancelled: false,
      };
      current = running;
      const work = Effect.gen(function* () {
        if (running.cancelled) return { stopReason: 'cancelled' as const };
        const run = yield* client
          .send({ input, prepared: frozen, output, relay, cancelled: () => running.cancelled, permitted: ask })
          .pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? Deferred.succeed(running.sent, null) : Effect.void)));
        running.run = run;
        yield* Deferred.succeed(running.sent, run);
        if (running.cancelled) yield* run.cancel;
        const outcome = yield* run.wait;
        if (outcome.detail !== undefined) process.stderr(`${outcome.detail}\n`);
        const turn = outcome.turn ?? input.id;
        const meta = { 'tagma/turn': { prompt: turn, last: turn }, 'tagma/failure': outcome.failure };
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
          yield* Deferred.succeed(running.sent, null);
          yield* Deferred.done(running.done, exit);
          if (Exit.isFailure(exit) && Cause.hasDies(exit.cause)) yield* process.died(Cause.pretty(exit.cause));
        }),
        scope,
      );
      return Deferred.await(running.done);
    }),
    steer: Effect.fnUntraced(function* (prompt, input) {
      const run = yield* sentRun();
      if (run?.steer === undefined) return { outcome: 'promptRequired' as const };
      return yield* run.steer(prompt, input);
    }),
    withdraw: Effect.fnUntraced(function* (input) {
      const run = yield* sentRun();
      if (run?.withdraw === undefined)
        return yield* new AgentFault({ code: FAULT.methodNotFound, message: 'this agent cannot withdraw words' });
      return yield* run.withdraw(input);
    }),
    compact:
      compact === undefined
        ? undefined
        : Effect.fnUntraced(function* (instructions, at) {
            if (at === 'step')
              return yield* new AgentFault({ code: UNSTEPPED, message: 'this agent compacts its session only between turns' });
            if (current !== null || compacting !== null)
              return yield* new AgentFault({ code: FAULT.invalidRequest, message: 'this session is busy; compaction runs between turns' });
            const compaction = yield* compact(instructions, output);
            compacting = compaction;
            return yield* compaction.wait.pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  if (compacting === compaction) compacting = null;
                }),
              ),
            );
          }),
    cancel,
    close: Effect.fnUntraced(function* () {
      const running = current;
      yield* cancel();
      if (running !== null) yield* Deferred.await(running.done).pipe(Effect.orDie);
      yield* client.close;
    }),
  } satisfies Session;
});
