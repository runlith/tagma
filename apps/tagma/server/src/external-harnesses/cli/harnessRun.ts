import { Effect, Logger, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import { PROGRAM_RELEASE } from '../../platform/contract/wire/program.js';
import { CurrentInvocation, noting } from '../../platform/cli/verb.js';
import { runCut } from '../runner/claude-code/cut.js';
import { runClaude } from '../runner/claude-code/run.js';
import { EFFORTS } from '../runner/claude-code/settings.js';
import { runCursor } from '../runner/cursor/run.js';
import { runOpenCode } from '../runner/opencode/run.js';
import type { ServerCli } from './server.js';

export const harnessRun = (server: ServerCli) =>
  Command.make(
    'harness-run',
    {
      harness: Argument.Literals('harness', ['claude-code', 'cursor', 'opencode'] as const),
      model: Flag.String('model').pipe(Flag.optional, Flag.withMetavar('model'), Flag.withDescription('the model the session opens on')),
      effort: Flag.String('effort').pipe(Flag.optional, Flag.withDescription('the reasoning setting the session opens at')),
      untitled: Flag.Boolean('untitled').pipe(
        Flag.withDescription('keep the CLI from naming its session; Tagma names the thread'),
        Flag.withDefault(false),
      ),
      cut: Flag.Boolean('cut').pipe(
        Flag.withDescription("answer offline cuts of this CLI's sessions on stdin and stdout instead of running an agent"),
        Flag.withDefault(false),
      ),
    },
    ({ harness, model, effort, untitled, cut }) =>
      Effect.flatMap(CurrentInvocation, (at) => {
        if (cut) return harness === 'claude-code' ? runCut(at) : Effect.die(`${harness} offers no offline cut`);
        const reasoning = Option.getOrNull(effort);
        if (harness === 'opencode')
          return runOpenCode(server, at, {
            model: Option.getOrNull(model),
            effort: reasoning,
            parameters: {},
            version: PROGRAM_RELEASE,
          });
        if (harness === 'cursor')
          return runCursor(server, at, {
            model: Option.getOrNull(model),
            effort: reasoning,
            parameters: {},
            version: PROGRAM_RELEASE,
          });
        const rung = EFFORTS.find((one) => one === reasoning) ?? null;
        if (reasoning !== null && rung === null) return Effect.die(`Claude Code does not offer effort ${reasoning}`);
        return runClaude(server, at, { model: Option.getOrNull(model), effort: rung, version: PROGRAM_RELEASE, titled: !untitled });
      }).pipe(Effect.provideService(Logger.LogToStderr, true)),
  ).pipe(
    Command.withDescription(
      'run a foreign agent as an ACP agent on stdin and stdout, for the Tagma thread whose grant this process carries',
    ),
    noting(`Started by the Tagma server for a thread on the acp transport; never called by hand.
claude-code  drives Claude Code through its Agent SDK: the prompt and tools of the
        native agent the thread hosts, served in process, the thread's grant on
        every call. With --cut it forks a session file offline for a terminal
        thread and reads the turns of the new root.
cursor  drives the local Cursor SDK with the hosted agent's prompt and tools;
        Tagma judges and executes every tool call.
opencode  drives a private OpenCode V2 host with the hosted agent's prompt and tools;
        Tagma judges and executes every tool call.`),
  );
