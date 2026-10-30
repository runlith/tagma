import { Cause, Deferred, Effect, Exit, Schema } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import type { ContentBlock } from '@runlith/acp/content';
import type { PromptResult } from '@runlith/acp/methods';
import type { SessionConfigOption } from '@runlith/acp/updates';
import type { ModelSwitches } from '@runlith/llm/models/description';
import { SAID, RETRYING } from '@runlith/hosted-runner/wire/extensions';
import type { Cycle, Process, Prepared, Session } from '@runlith/hosted-runner/cycle';
import type { HostedDoor } from '@runlith/hosted-runner/door';
import { Handed } from '@runlith/hosted-runner/handed';
import { historyBlocks } from '@runlith/hosted-runner/history';
import { Output } from '@runlith/hosted-runner/output';
import { Relay } from '@runlith/hosted-runner/relay';
import { OpenCodeSdk, type Run } from './channel.js';

export type Launch = {
  readonly model: string | null;
  readonly effort: string | null;
  readonly parameters: ModelSwitches;
  readonly version: string;
};
type Running = { readonly done: Deferred.Deferred<PromptResult, AgentFault>; run: Run | null; cancelled: boolean };
const failed = (cause: unknown) => new AgentFault({ code: FAULT.internal, message: String(cause) });

export const makeOpenCodeCycle = Effect.fnUntraced(function* (door: HostedDoor, process: Process, launch: Launch) {
  const sdk = yield* OpenCodeSdk;
  const scope = yield* Effect.scope;
  let model = launch.model;
  let effort = launch.effort;
  let parameters = launch.parameters;
  const configOptions = (): readonly SessionConfigOption[] => [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: model ?? '',
      options: [{ value: model ?? '', name: model ?? 'Default' }],
    },
    {
      id: 'effort',
      name: 'Reasoning',
      category: 'thought_level',
      type: 'select',
      currentValue: effort ?? '',
      options: [{ value: effort ?? '', name: effort ?? 'Default' }],
    },
    {
      id: 'parameters',
      name: 'Parameters',
      type: 'select',
      currentValue: JSON.stringify(parameters),
      options: [{ value: JSON.stringify(parameters), name: 'Parameters' }],
    },
  ];
  const cycle: Cycle = {
    extensions: [SAID, RETRYING],
    initialize: {
      protocolVersion: 1,
      agentInfo: { name: 'tagma-opencode', version: launch.version },
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true }, sessionCapabilities: { resume: {}, close: {} } },
    },
    modes: { currentModeId: 'agent', availableModes: [{ id: 'agent', name: 'Agent' }] },
    open: Effect.fnUntraced(function* (opening, outlet, replacing) {
      const channel = yield* sdk.open({ id: opening.origin === 'new' ? null : opening.id, cwd: opening.cwd }, replacing);
      let history = opening.origin === 'new' ? historyBlocks(opening.history) : [];
      let prepared: Prepared | null = null;
      let current: Running | null = null;
      const handed = new Handed();
      const output = new Output(channel.id, outlet, handed);
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
      const session: Session = {
        id: channel.id,
        cwd: opening.cwd,
        configOptions,
        busy: () => current !== null,
        prepare: (input) =>
          Effect.sync(() => {
            prepared = input;
          }),
        start: Effect.fnUntraced(function* (input) {
          if (current !== null || prepared === null)
            return yield* new AgentFault({ code: FAULT.invalidRequest, message: 'OpenCode has no prepared idle turn' });
          if (model === null || Object.keys(parameters).length > 0)
            return yield* new AgentFault({
              code: FAULT.invalidParams,
              message: 'OpenCode requires a provider/model id and supports only its declared reasoning variant',
            });
          const frozen = prepared;
          const selection = { model, effort };
          const running: Running = { done: yield* Deferred.make<PromptResult, AgentFault>(), run: null, cancelled: false };
          current = running;
          prepared = null;
          const work = Effect.gen(function* () {
            const blocks: ContentBlock[] = [...history];
            if (input.context !== null) blocks.push({ type: 'text', text: input.context });
            blocks.push(...input.prompt);
            if (running.cancelled) return { stopReason: 'cancelled' as const };
            const run = yield* channel.send({
              system: frozen.opened.prompt ?? '',
              blocks,
              selection,
              tools: frozen.listed.tools,
              event: output.event.bind(output),
              call: relay.call.bind(relay),
              taken: input.taken,
            });
            running.run = run;
            history = [];
            if (running.cancelled) yield* run.cancel;
            const outcome = yield* run.wait;
            if (outcome.detail !== undefined) process.stderr(`${outcome.detail}\n`);
            const meta = { 'tagma/turn': { prompt: input.id, last: input.id }, 'tagma/failure': outcome.failure };
            if (outcome.status === 'error' && !running.cancelled)
              return yield* new AgentFault({
                code: FAULT.internal,
                message: outcome.detail ?? 'The OpenCode execution failed',
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
        configure: Effect.fnUntraced(function* (id, value) {
          if (id === 'model') model = value || null;
          else if (id === 'effort') effort = value || null;
          else if (id === 'parameters') {
            const next = yield* Effect.try({ try: () => JSON.parse(value) as unknown, catch: failed }).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.String))),
              Effect.mapError(failed),
            );
            if (Object.keys(next).length > 0)
              return yield* new AgentFault({ code: FAULT.invalidParams, message: 'OpenCode has no declared additional parameters' });
            parameters = next;
          } else return yield* new AgentFault({ code: FAULT.invalidParams, message: `OpenCode has no configuration option ${id}` });
          return configOptions();
        }),
        close: Effect.fnUntraced(function* () {
          const running = current;
          yield* cancel();
          if (running !== null) yield* Deferred.await(running.done).pipe(Effect.orDie);
          yield* channel.close;
        }),
      };
      return session;
    }),
  };
  return cycle;
});
