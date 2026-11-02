import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import type { ContentBlock } from '@runlith/acp/content';
import { cursorSelection } from '../selection.js';
import { FORK, RETRYING, SAID } from '@runlith/hosted-runner/wire/extensions';
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
  const digest = (text: string) => createHash('sha256').update(text).digest('hex');
  const promptPath = (directory: string, id: string) => join(directory, `${digest(id)}.prompt`);
  const turnPath = (directory: string, id: string, turn: string, side: 'before' | 'after') =>
    join(directory, `${digest(id)}.${digest(turn)}.${side}`);
  const open: Cycle['open'] = Effect.fnUntraced(function* (opening, outlet, replacing) {
    yield* replacing;
    const channel = yield* sdk.open({
      id: opening.origin === 'new' ? null : opening.id,
      cwd: opening.cwd,
      directory: join(home.directory, 'store'),
      apiKey: home.apiKey,
      model: selection(),
    });
    const currentPrompt = promptPath(home.directory, channel.id);
    let delivered = yield* files.readFileString(currentPrompt).pipe(
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)),
      Effect.mapError(failed),
      Effect.onError(() => channel.close),
    );
    let history = opening.origin === 'new' ? historyBlocks(opening.history) : [];
    let resumed = opening.origin === 'resume';
    const forkMarker = join(home.directory, 'store', 'tagma-fork.json');
    let pristine = yield* files.exists(forkMarker).pipe(
      Effect.mapError(failed),
      Effect.onError(() => channel.close),
    );
    return yield* clientSession(
      {
        id: channel.id,
        cwd: opening.cwd,
        configOptions: options.options,
        configure: options.configure.bind(options),
        send: Effect.fnUntraced(function* ({ input, prepared, output, relay, cancelled }) {
          const chosen = selection();
          const prompt = prepared.opened.prompt;
          const before = delivered;
          const hash = prompt === null ? delivered : digest(prompt);
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
          if (pristine) {
            yield* files.remove(forkMarker).pipe(Effect.mapError(failed));
            pristine = false;
          }
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
                Effect.fn('CursorCycle.recordPrompt')(function* (outcome) {
                  const after = !cancelled() && outcome.status === 'finished' ? hash : before;
                  if (outcome.turn !== undefined) {
                    yield* files
                      .writeFileString(turnPath(home.directory, channel.id, outcome.turn, 'before'), before ?? '')
                      .pipe(Effect.mapError(failed));
                    yield* files
                      .writeFileString(turnPath(home.directory, channel.id, outcome.turn, 'after'), after ?? '')
                      .pipe(Effect.mapError(failed));
                  }
                  if (after !== null && after !== delivered) {
                    yield* files.writeFileString(currentPrompt, after).pipe(Effect.mapError(failed));
                    delivered = after;
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
  });
  return {
    extensions: [FORK, SAID, RETRYING],
    initialize: {
      protocolVersion: 1,
      agentInfo: { name: 'tagma-cursor', version: launch.version },
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true }, sessionCapabilities: { resume: {}, close: {} } },
    },
    modes: { currentModeId: 'agent', availableModes: [{ id: 'agent', name: 'Agent' }] },
    open,
    fork: Effect.fn('CursorCycle.fork')(function* (point, outlet, replacing) {
      if (point.storage === null) return yield* new AgentFault({ code: FAULT.notFound, message: 'The Cursor source storage is missing.' });
      if (point.storage === home.directory)
        return yield* new AgentFault({ code: FAULT.invalidRequest, message: 'The Cursor fork needs separate thread storage.' });
      yield* replacing;
      const target = join(home.directory, 'store');
      const marker = JSON.stringify(point);
      const resume = () =>
        open(
          { id: point.from, cwd: point.cwd, mcpServers: [], additionalDirectories: [], origin: 'resume', history: [] },
          outlet,
          Effect.void,
        );
      if (yield* files.exists(target).pipe(Effect.mapError(failed))) {
        const existing = yield* files.readFileString(join(target, 'tagma-fork.json')).pipe(
          Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)),
          Effect.mapError(failed),
        );
        if (existing !== marker)
          return yield* new AgentFault({ code: FAULT.internal, message: 'The Cursor fork destination already contains a session store.' });
        return yield* resume();
      }
      const address = point.turn ?? point.through;
      const side = point.turn === null ? 'after' : 'before';
      const hash =
        address === null
          ? ''
          : yield* files.readFileString(turnPath(point.storage, point.from, address, side)).pipe(
              Effect.catchReason('PlatformError', 'NotFound', () =>
                Effect.fail(new AgentFault({ code: FAULT.notFound, message: 'The Cursor fork instruction state is missing.' })),
              ),
              Effect.mapError((cause) => (cause instanceof AgentFault ? cause : failed(cause))),
            );
      const staging = yield* Effect.acquireRelease(
        files.makeTempDirectory({ directory: home.directory, prefix: 'fork-' }).pipe(Effect.mapError(failed)),
        (directory) => files.remove(directory, { recursive: true, force: true }).pipe(Effect.orDie),
      );
      yield* sdk
        .fork({
          id: point.from,
          source: join(point.storage, 'store'),
          directory: staging,
          cwd: point.cwd,
          turn: point.turn,
          through: point.through,
        })
        .pipe(Effect.provideService(FileSystem.FileSystem, files));
      const names = yield* files.readDirectory(point.storage).pipe(Effect.mapError(failed));
      const prefix = `${digest(point.from)}.`;
      yield* Effect.forEach(
        names.filter((name) => name.startsWith(prefix) && (name.endsWith('.before') || name.endsWith('.after'))),
        (name) => files.copyFile(join(point.storage!, name), join(home.directory, name)).pipe(Effect.mapError(failed)),
        { discard: true },
      );
      if (hash !== '') yield* files.writeFileString(promptPath(home.directory, point.from), hash).pipe(Effect.mapError(failed));
      yield* files.writeFileString(join(staging, 'tagma-fork.json'), marker).pipe(Effect.mapError(failed));
      yield* files.rename(staging, target).pipe(Effect.mapError(failed));
      return yield* resume();
    }, Effect.scoped),
  } satisfies Cycle;
});
