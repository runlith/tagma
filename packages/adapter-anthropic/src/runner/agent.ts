import { Effect } from 'effect';
import type { EffortLevel, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { AgentFault, FAULT, type AgentHandlers, type Outlet } from '@runlith/acp/agent';
import type { ContentBlock } from '@runlith/acp/content';
import { PROTOCOL, type McpServer } from '@runlith/acp/methods';
import { EXTENSIONS, NOTIFICATIONS } from '@runlith/hosted-runner/wire/extensions';
import { hostedAgent } from '@runlith/hosted-runner/agent';
import type { Cycle, Opening as HostedOpening } from '@runlith/hosted-runner/cycle';
import type { HostedDoor } from '@runlith/hosted-runner/door';
import type { ClaudeSdk } from './channel.js';
import type { Opening, Origin } from './opening.js';
import type { Runner } from './runner.js';
import { ClaudeSession } from './session.js';
import { MODES, Settings } from './settings.js';
import { seed } from './transcript.js';

export type Launch = {
  readonly model: string | null;
  readonly effort: EffortLevel | null;
  readonly version: string;
  readonly titled: boolean;
};

const serverOf = (server: McpServer): readonly [string, McpServerConfig] => {
  if ('command' in server)
    return [
      server.name,
      {
        type: 'stdio',
        command: server.command,
        args: [...server.args],
        env: Object.fromEntries(server.env.map((pair) => [pair.name, pair.value])),
      },
    ];
  return [
    server.name,
    { type: server.type, url: server.url, headers: Object.fromEntries(server.headers.map((pair) => [pair.name, pair.value])) },
  ];
};

export const claudeAgent =
  (sdk: ClaudeSdk, door: HostedDoor, runner: Runner, launch: Launch) =>
  (outlet: Outlet): AgentHandlers<never> => {
    const settings = new Settings(launch.model, launch.effort, launch.titled);
    const opened = Effect.fnUntraced(function* (opening: Opening) {
      return yield* ClaudeSession.open(sdk, door, runner, settings, outlet, opening);
    });
    const opening = (input: HostedOpening, origin: Origin, recap: readonly ContentBlock[] = []): Opening => ({
      id: input.id,
      cwd: input.cwd,
      directories: input.additionalDirectories,
      servers: Object.fromEntries(input.mcpServers.map(serverOf)),
      origin,
      recap,
    });
    const transcribed = (id: string, cwd: string) =>
      Effect.tryPromise({
        try: () => sdk.transcript(id, cwd),
        catch: (cause) =>
          new AgentFault({
            code: FAULT.notFound,
            message: `session ${id} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
          }),
      });
    const cycle: Cycle = {
      initialize: {
        protocolVersion: PROTOCOL,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: true, embeddedContext: true },
          sessionCapabilities: { resume: {}, close: {} },
        },
        authMethods: [{ id: 'claude-code', name: 'claude auth login', description: 'Claude Code signs in through its own CLI.' }],
        agentInfo: { name: 'tagma-claude-code', title: 'Claude Code through Tagma', version: launch.version },
      },
      modes: MODES,
      extensions: [...EXTENSIONS, ...NOTIFICATIONS],
      open: Effect.fnUntraced(function* (input, _outlet, replacing) {
        if (input.origin === 'resume') {
          if (input.held !== input.id && (yield* transcribed(input.id, input.cwd)).length === 0)
            return yield* new AgentFault({ code: FAULT.notFound, message: `Claude Code holds no conversation ${input.id}` });
          yield* replacing;
          return yield* opened(opening(input, { _tag: 'Resume', sessionId: input.id }));
        }
        const seeded =
          input.history.length === 0
            ? null
            : yield* seed(
                sdk,
                input.history,
                { id: input.id, cwd: input.cwd, version: runner.version(), model: settings.model },
                runner.stderr,
              );
        yield* replacing;
        return yield* opened(
          opening(
            input,
            seeded?._tag === 'Transcript' ? { _tag: 'Resume', sessionId: input.id } : { _tag: 'New' },
            seeded?._tag === 'Recap' ? seeded.recap : [],
          ),
        );
      }),
      fork: Effect.fnUntraced(function* (from, cwd, turn, _outlet, replacing) {
        const id = crypto.randomUUID();
        const input: HostedOpening = { id, cwd, mcpServers: [], additionalDirectories: [], origin: 'new', history: [] };
        if (turn === null) {
          yield* replacing;
          return yield* opened(opening(input, { _tag: 'Fork', sessionId: from, at: null }));
        }
        const messages = yield* transcribed(from, cwd);
        const at = messages.findIndex((message) => message.type === 'user' && message.uuid === turn);
        if (at < 0) return yield* new AgentFault({ code: FAULT.invalidParams, message: `session ${from} holds no turn ${turn}` });
        const kept = messages[at - 1]?.uuid ?? null;
        yield* replacing;
        return yield* opened(opening(input, kept === null ? { _tag: 'New' } : { _tag: 'Fork', sessionId: from, at: kept }));
      }),
    };
    return hostedAgent(cycle, door)(outlet);
  };
