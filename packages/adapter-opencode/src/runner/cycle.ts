import { Effect } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import type { ContentBlock } from '@runlith/acp/content';
import { SAID, RETRYING } from '@runlith/hosted-runner/wire/extensions';
import type { Cycle, Process } from '@runlith/hosted-runner/cycle';
import { clientSession } from '@runlith/hosted-runner/client';
import type { HostedDoor } from '@runlith/hosted-runner/door';
import { historyBlocks } from '@runlith/hosted-runner/history';
import { Options, type ClientLaunch } from '@runlith/hosted-runner/options';
import { OpenCodeSdk } from './channel.js';

export const makeOpenCodeCycle = Effect.fnUntraced(function* (door: HostedDoor, process: Process, launch: ClientLaunch) {
  const sdk = yield* OpenCodeSdk;
  const scope = yield* Effect.scope;
  const options = new Options(launch, false);
  return {
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
      return yield* clientSession(
        {
          id: channel.id,
          cwd: opening.cwd,
          configOptions: options.options,
          configure: options.configure.bind(options),
          send: Effect.fnUntraced(function* ({ input, prepared, output, relay }) {
            const { model, effort, parameters } = options.read();
            if (model === null || Object.keys(parameters).length > 0)
              return yield* new AgentFault({
                code: FAULT.invalidParams,
                message: 'OpenCode requires a provider/model id and supports only its declared reasoning variant',
              });
            const blocks: ContentBlock[] = [...history];
            if (input.context !== null) blocks.push({ type: 'text', text: input.context });
            blocks.push(...input.prompt);
            const run = yield* channel.send({
              system: prepared.opened.prompt ?? '',
              blocks,
              selection: { model, effort },
              tools: prepared.listed.tools,
              event: output.event.bind(output),
              call: relay.call.bind(relay),
              taken: input.taken,
            });
            history = [];
            return run;
          }),
          close: channel.close,
        },
        door,
        process,
        outlet,
        scope,
      );
    }),
  } satisfies Cycle;
});
