import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Cause, Deferred, Effect, Exit, FileSystem, Schema } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import type { ContentBlock } from '@runlith/acp/content';
import type { PromptResult } from '@runlith/acp/methods';
import type { SessionConfigOption } from '@runlith/acp/updates';
import { cursorSelection } from '@runlith/adapter-cursor/selection';
import type { ModelSwitches } from '@runlith/llm/models/description';
import { COMPACTED, RETRYING, SAID } from '../../contract/wire/extensions.js';
import type { Cycle, Process, Session, Prepared } from '../hosted/cycle.js';
import type { HostedDoor } from '../hosted/door.js';
import { Handed } from '../hosted/handed.js';
import { historyBlocks } from '../hosted/history.js';
import { Output } from '../hosted/output.js';
import { Relay } from '../hosted/relay.js';
import { CursorSdk, type Message, type Run } from './channel.js';

export type Launch = {
  readonly model: string | null;
  readonly effort: string | null;
  readonly parameters: ModelSwitches;
  readonly version: string;
};
export type Home = { readonly directory: string; readonly apiKey: string };
type Running = { readonly done: Deferred.Deferred<PromptResult, AgentFault>; run: Run | null; cancelled: boolean };
const FAILED = (cause: unknown) => new AgentFault({ code: FAULT.internal, message: String(cause) });

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

export const makeCursorCycle = Effect.fnUntraced(function* (door: HostedDoor, process: Process, home: Home, launch: Launch) {
  const sdk = yield* CursorSdk;
  const files = yield* FileSystem.FileSystem;
  const scope = yield* Effect.scope;
  let model = launch.model;
  let effort = launch.effort;
  let parameters = launch.parameters;
  const selection = () => (model === null ? undefined : cursorSelection(model, effort, parameters));
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
    extensions: [SAID, COMPACTED, RETRYING],
    initialize: {
      protocolVersion: 1,
      agentInfo: { name: 'tagma-cursor', version: launch.version },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true },
        sessionCapabilities: { resume: {}, close: {} },
        _meta: { 'tagma/extensions': [SAID, COMPACTED, RETRYING] },
      },
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
        Effect.mapError(FAILED),
        Effect.onError(() => channel.close),
      );
      let history = opening.origin === 'new' && opening.history.length > 0 ? historyBlocks(opening.history) : [];
      let prepared: Prepared | null = null;
      let resumed = opening.origin === 'resume';
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
            return yield* new AgentFault({ code: FAULT.invalidRequest, message: 'Cursor has no prepared idle turn' });
          const frozen = prepared;
          const chosen = selection();
          const running: Running = { done: yield* Deferred.make<PromptResult, AgentFault>(), run: null, cancelled: false };
          current = running;
          const work = Effect.gen(function* () {
            const prompt = frozen.opened.prompt;
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
            const message = yield* Effect.try({ try: () => messageOf(blocks), catch: FAILED });
            const run = yield* channel.send({
              id: input.id,
              message,
              model: chosen,
              tools: frozen.listed.tools,
              force: resumed,
              event: output.event.bind(output),
              call: relay.call.bind(relay),
            });
            yield* input.taken;
            running.run = run;
            history = [];
            resumed = false;
            if (running.cancelled) yield* run.cancel;
            const outcome = yield* run.wait;
            if (!running.cancelled && outcome.status === 'error')
              return yield* new AgentFault({
                code: outcome.failure?.reason?.family === 'auth' ? FAULT.authRequired : FAULT.internal,
                message: outcome.detail ?? 'Cursor failed this turn.',
                data: {
                  usage: outcome.usage,
                  'tagma/failure': outcome.failure,
                  _meta: { 'tagma/turn': { prompt: input.id, last: input.id } },
                },
              });
            if (!running.cancelled && outcome.status === 'finished' && hash !== null) {
              yield* files.writeFileString(promptPath, hash).pipe(Effect.mapError(FAILED));
              delivered = hash;
            }
            const result: PromptResult = {
              stopReason: running.cancelled || outcome.status === 'cancelled' ? 'cancelled' : 'end_turn',
              usage: outcome.usage,
              _meta: { 'tagma/turn': { prompt: input.id, last: input.id }, 'tagma/failure': outcome.failure },
            };
            if (outcome.detail !== undefined) process.stderr(`${outcome.detail}\n`);
            return result;
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
            parameters = yield* Effect.try({ try: () => JSON.parse(value) as unknown, catch: FAILED }).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.String))),
              Effect.mapError(FAILED),
            );
          } else return yield* new AgentFault({ code: FAULT.invalidParams, message: `Cursor has no configuration option ${id}` });
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
