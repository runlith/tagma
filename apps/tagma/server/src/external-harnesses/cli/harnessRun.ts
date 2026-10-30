import { Effect, Logger, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import type { HostedRunner } from '@runlith/hosted-runner/run';
import { PROGRAM_RELEASE } from '../../platform/contract/wire/program.js';
import { CurrentInvocation, noting } from '../../platform/cli/verb.js';
import { runAsk, runCursor } from '../runner/cursor/run.js';
import { runOpenCode } from '../runner/opencode/run.js';
import type { ServerCli } from './server.js';
import { ServerDoor } from './serverDoor.js';

export type HostedRunners = ReadonlyMap<string, () => Promise<HostedRunner>>;

export const harnessRun = (server: ServerCli, runners: HostedRunners) =>
  Command.make(
    'harness-run',
    {
      harness: Argument.String('harness'),
      model: Flag.String('model').pipe(Flag.optional, Flag.withMetavar('model'), Flag.withDescription('the model the session opens on')),
      effort: Flag.String('effort').pipe(Flag.optional, Flag.withDescription('the reasoning setting the session opens at')),
      ask: Flag.Boolean('ask').pipe(Flag.withDefault(false), Flag.withDescription('answer one tool-less prompt from stdin')),
      system: Flag.String('system').pipe(Flag.withDefault(''), Flag.withDescription('instructions for a fresh ask')),
      untitled: Flag.Boolean('untitled').pipe(
        Flag.withDescription('keep the CLI from naming its session; Tagma names the thread'),
        Flag.withDefault(false),
      ),
      cut: Flag.Boolean('cut').pipe(
        Flag.withDescription("answer offline cuts of this CLI's sessions on stdin and stdout instead of running an agent"),
        Flag.withDefault(false),
      ),
    },
    ({ harness, model, effort, untitled, cut, ask, system }) =>
      Effect.flatMap(CurrentInvocation, (at) => {
        if (ask) {
          if (harness !== 'cursor' || cut) return Effect.die('--ask requires cursor and cannot be combined with --cut');
          if (Option.isNone(model)) return Effect.die('--ask requires --model');
          return runAsk(at, model.value, Option.getOrNull(effort), system);
        }
        const reasoning = Option.getOrNull(effort);
        if (!cut && harness === 'opencode')
          return runOpenCode(server, at, {
            model: Option.getOrNull(model),
            effort: reasoning,
            parameters: {},
            version: PROGRAM_RELEASE,
          });
        if (!cut && harness === 'cursor')
          return runCursor(server, at, {
            model: Option.getOrNull(model),
            effort: reasoning,
            parameters: {},
            version: PROGRAM_RELEASE,
          });
        const load = runners.get(harness);
        if (load === undefined) return Effect.die(`${harness} ships no hosted runner`);
        return Effect.flatMap(Effect.promise(load), (runner): Effect.Effect<void, unknown> => {
          if (!cut)
            return runner.run(at, new ServerDoor(server, at), {
              model: Option.getOrNull(model),
              effort: reasoning,
              version: PROGRAM_RELEASE,
              titled: !untitled,
            });
          return runner.cut === null ? Effect.die(`${harness} offers no offline cut`) : runner.cut(at);
        });
      }).pipe(Effect.provideService(Logger.LogToStderr, true)),
  ).pipe(
    Command.withDescription(
      'run a foreign agent as an ACP agent on stdin and stdout, for the Tagma thread whose grant this process carries',
    ),
    noting(`Started by the Tagma server for a thread on the acp transport; never called by hand.
A harness whose builtin package ships a hosted runner drives its vendor's SDK with
        the prompt and tools of the native agent the thread hosts, the thread's grant
        on every call. With --cut it forks a session file offline for a terminal
        thread and reads the turns of the new root, where the runner offers that.
cursor  drives the local Cursor SDK with the hosted agent's prompt and tools;
        Tagma judges and executes every tool call.
opencode  drives a private OpenCode V2 host with the hosted agent's prompt and tools;
        Tagma judges and executes every tool call.`),
  );
