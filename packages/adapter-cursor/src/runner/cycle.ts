import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import type { ContentBlock } from '@runlith/acp/content';
import { cursorSelection } from '../selection.js';
import { COMPACTED, RETRYING, SAID } from '@runlith/hosted-runner/wire/extensions';
import type { Cycle, Process } from '@runlith/hosted-runner/cycle';
import { clientSession } from '@runlith/hosted-runner/client';
import type { HostedDoor } from '@runlith/hosted-runner/door';
import { historyBlocks } from '@runlith/hosted-runner/history';
import { Options, type ClientLaunch } from '@runlith/hosted-runner/options';
import { CursorSdk, type Message } from './channel.js';

export type Home = { readonly directory: string; readonly apiKey: string };
const failed = (cause: unknown) => new AgentFault({ code: FAULT.internal, message: String(cause) });

const messageOf = (blocks: readonly ContentBlock[]): Message => {
  const text: string[] = [];
  const images: { data: string; mimeType: string }[] = [];
  for (const block of blocks) {
    if (block.type === 'text') text.push(block.text);
    else if (block.type === 'image') {
      images.push({ data: block.data, mimeType: block.mimeType });
      text.push(`[Image ${images.length} at this position in the conversation]`);
    } else throw new Error(`Cursor cannot receive ${block.type} content`);
  }
  return { text: text.join('\n\n'), images };
};

export const makeCursorCycle = Effect.fnUntraced(function* (door: HostedDoor, process: Process, home: Home, launch: ClientLaunch) {
  const sdk = yield* CursorSdk;
  const files = yield* FileSystem.FileSystem;
  const scope = yield* Effect.scope;
  const options = new Options(launch, true);
  const selection = () => {
    const { model, effort, parameters } = options.read();
    return model === null ? undefined : cursorSelection(model, effort, parameters);
  };
  return {
    extensions: [SAID, COMPACTED, RETRYING],
    initialize: {
      protocolVersion: 1,
      agentInfo: { name: 'tagma-cursor', version: launch.version },
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true }, sessionCapabilities: { resume: {}, close: {} } },
    },
    modes: { currentModeId: 'agent', availableModes: [{ id: 'agent', name: 'Agent' }] },
    open: Effect.fnUntraced(function* (opening, outlet, replacing) {
      yield* replacing;
      const channel = yield* sdk.open({
        id: opening.origin === 'new' ? null : opening.id,
        cwd: opening.cwd,
        directory: join(home.directory, 'store'),
        apiKey: home.apiKey,
        model: selection(),
      });
      const promptPath = join(home.directory, `${createHash('sha256').update(channel.id).digest('hex')}.prompt`);
      let delivered = yield* files.readFileString(promptPath).pipe(
        Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)),
        Effect.mapError(failed),
        Effect.onError(() => channel.close),
      );
      let history = opening.origin === 'new' ? historyBlocks(opening.history) : [];
      let resumed = opening.origin === 'resume';
      return yield* clientSession(
        {
          id: channel.id,
          cwd: opening.cwd,
          configOptions: options.options,
          configure: options.configure.bind(options),
          send: Effect.fnUntraced(function* ({ input, prepared, output, relay, cancelled }) {
            const chosen = selection();
            const prompt = prepared.opened.prompt;
            const hash = prompt === null ? delivered : createHash('sha256').update(prompt).digest('hex');
            const blocks: ContentBlock[] = [];
            if (prompt !== null && hash !== delivered)
              blocks.push({
                type: 'text',
                text: `<tagma-instructions>\nThese instructions replace the previous Tagma instructions. Tagma tools are served by custom-user-tools; use the exact tool names in the tool list.\n${prompt}\n</tagma-instructions>`,
              });
            blocks.push(...history);
            if (input.context !== null) blocks.push({ type: 'text', text: input.context });
            blocks.push(...input.prompt);
            const message = yield* Effect.try({ try: () => messageOf(blocks), catch: failed });
            const run = yield* channel.send({
              id: input.id,
              message,
              model: chosen,
              tools: prepared.listed.tools,
              force: resumed,
              event: output.event.bind(output),
              call: relay.call.bind(relay),
            });
            yield* input.taken;
            history = [];
            resumed = false;
            return {
              cancel: run.cancel,
              wait: run.wait.pipe(
                Effect.tap(
                  Effect.fnUntraced(function* (outcome) {
                    if (!cancelled() && outcome.status === 'finished' && hash !== null) {
                      yield* files.writeFileString(promptPath, hash).pipe(Effect.mapError(failed));
                      delivered = hash;
                    }
                  }),
                ),
              ),
            };
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
