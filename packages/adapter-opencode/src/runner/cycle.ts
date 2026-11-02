import { Effect } from 'effect';
import { AgentFault, FAULT, type Outlet } from '@runlith/acp/agent';
import type { ContentBlock } from '@runlith/acp/content';
import { COMPACT, COMPACTED, FORK, MEASURED, SAID, RETRYING } from '@runlith/hosted-runner/wire/extensions';
import type { Cycle, ForkPoint, Opening, Process } from '@runlith/hosted-runner/cycle';
import { clientSession } from '@runlith/hosted-runner/client';
import type { HostedDoor } from '@runlith/hosted-runner/door';
import { historyBlocks } from '@runlith/hosted-runner/history';
import { Options, type ClientLaunch } from '@runlith/hosted-runner/options';
import { OpenCodeSdk } from './channel.js';

export const makeOpenCodeCycle = Effect.fnUntraced(function* (door: HostedDoor, process: Process, launch: ClientLaunch) {
  const sdk = yield* OpenCodeSdk;
  const scope = yield* Effect.scope;
  const options = new Options(launch, false);
  const open = Effect.fnUntraced(function* (
    opening: Opening,
    outlet: Outlet,
    replacing: Effect.Effect<void, AgentFault>,
    fork?: ForkPoint,
  ) {
    const channel = yield* sdk.open({ id: opening.origin === 'new' ? null : opening.id, cwd: opening.cwd, fork }, replacing);
    let history = opening.origin === 'new' ? historyBlocks(opening.history) : [];
    const selection = Effect.fnUntraced(function* () {
      const { model, effort, parameters } = options.read();
      if (model === null || Object.keys(parameters).length > 0)
        return yield* new AgentFault({
          code: FAULT.invalidParams,
          message: 'OpenCode requires a provider/model id and supports only its declared reasoning variant',
        });
      return { model, effort };
    });
    const session = yield* clientSession(
      {
        id: channel.id,
        cwd: opening.cwd,
        configOptions: options.options,
        configure: options.configure.bind(options),
        send: Effect.fnUntraced(function* ({ input, prepared, output, relay }) {
          const selected = yield* selection();
          const blocks: ContentBlock[] = [...history];
          if (input.context !== null) blocks.push({ type: 'text', text: input.context });
          blocks.push(...input.prompt);
          return yield* channel.send({
            system: prepared.opened.prompt ?? '',
            blocks,
            selection: selected,
            tools: prepared.listed.tools,
            event: output.event.bind(output),
            call: relay.call.bind(relay),
            taken: Effect.andThen(
              Effect.sync(() => {
                history = [];
              }),
              input.taken,
            ),
          });
        }),
        close: channel.close,
      },
      door,
      process,
      outlet,
      scope,
    );
    let compacting = false;
    return {
      ...session,
      busy: () => compacting || session.busy(),
      cancel: () =>
        Effect.andThen(channel.cancelCompaction, session.cancel()).pipe(
          Effect.catchTag('AgentFault', (cause) => process.died(cause.message)),
        ),
      compact: Effect.fnUntraced(function* (instructions, at) {
        if (history.length > 0)
          return yield* new AgentFault({
            code: FAULT.invalidRequest,
            message: 'OpenCode must accept the restored journal in a prompt before compacting this session',
          });
        if (compacting) return yield* new AgentFault({ code: FAULT.invalidRequest, message: 'OpenCode already has a pending compaction' });
        compacting = true;
        return yield* Effect.gen(function* () {
          const selected = yield* selection();
          const agent = yield* door.agent();
          const result = yield* channel.compact({
            system: agent.prompt,
            instructions,
            at,
            selection: selected,
            measure: (reading) =>
              outlet.update({
                sessionId: channel.id,
                update: { sessionUpdate: 'usage_update', used: reading.input + reading.output, size: 0, _meta: { [MEASURED]: reading } },
              }),
          });
          yield* outlet.notify(COMPACTED, { sessionId: channel.id, trigger: 'manual', summary: result.summary });
          return { summary: result.summary, usage: result.usage };
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              compacting = false;
            }),
          ),
        );
      }),
    };
  });
  return {
    extensions: [COMPACT, COMPACTED, FORK, SAID, RETRYING],
    initialize: {
      protocolVersion: 1,
      agentInfo: { name: 'tagma-opencode', version: launch.version },
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true }, sessionCapabilities: { resume: {}, close: {} } },
    },
    modes: { currentModeId: 'agent', availableModes: [{ id: 'agent', name: 'Agent' }] },
    open,
    fork: (point, outlet, replacing) =>
      open(
        { id: point.from, cwd: point.cwd, origin: 'resume', history: [], mcpServers: [], additionalDirectories: [] },
        outlet,
        replacing,
        point,
      ),
  } satisfies Cycle;
});
