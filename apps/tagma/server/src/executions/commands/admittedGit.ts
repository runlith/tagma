import { Effect } from 'effect';
import { type EnvironmentEntry, HostRequestKey } from '@runlith/executions/protocol/execution';
import type { CommandEnvironmentRequest } from '@runlith/executions/CommandEnvironment';
import type { StdinPolicy } from '@runlith/executions/protocol/launch';
import { GitEndingUnreadable, GitNotAdmitted, GitUnavailable, type Git, type GitOptions, type GitAnswer } from '@runlith/git/Git';
import type { CommandCreator } from '../contract/wire/commands.js';
import type { CommandSubject } from '../contract/wire/commandSubject.js';
import { ownGitOptions } from '../../platform/git/ownGit.js';
import type { TerminalActor } from '../contract/wire/terminals.js';
import { terminalRefusal } from '../terminals/refusal.js';
import { admittedCommand } from './admitted.js';
import type { CommandAccess } from '../contract/service/access.js';
import type { TerminalTargets } from '../contract/service/targets.js';
import type { ManagedCommands } from '../contract/service/commands.js';
import type { Terminals } from '../contract/service/terminals.js';

export type AdmittedGit = {
  readonly terminals: Terminals['Service'];
  readonly commands: ManagedCommands['Service'];
  readonly access: CommandAccess['Service'];
  readonly targets: TerminalTargets['Service'];
  readonly projectId: number;
  readonly actor: TerminalActor;
  readonly owner: CommandSubject;
  readonly creator: CommandCreator;
  readonly tool: string;
  readonly root: string;
  readonly key: string;
  readonly bytes: number;
};

const PROGRAM = 'git';

export const carriedStdin = (options: GitOptions | undefined): StdinPolicy | null =>
  options?.stdin === undefined || options.stdin === '' ? 'ignore' : null;

const environmentOf = (options: GitOptions | undefined): CommandEnvironmentRequest | undefined => {
  if (options?.env === undefined) return undefined;
  const entries: EnvironmentEntry[] = [];
  for (const [name, value] of Object.entries(options.env)) {
    entries.push(value === undefined ? { _tag: 'Unset', name } : { _tag: 'Set', name, value });
  }
  return { inherit: options.extendEnv === true, entries };
};

export const admittedGit = (input: AdmittedGit): Git['Service'] => {
  const targets = input.targets.scope();
  let taken = 0;
  return {
    run: Effect.fn('AdmittedGit.run')(function* (args, asked) {
      const options = ownGitOptions(asked);
      const stdin = carriedStdin(options);
      if (stdin === null) {
        return yield* new GitUnavailable({
          command: args,
          reason: 'this git command writes to its own input, and an admitted command has no act that carries bytes into one',
        });
      }
      taken += 1;
      const ending = yield* admittedCommand({
        terminals: input.terminals,
        commands: input.commands,
        access: input.access,
        targets,
        projectId: input.projectId,
        actor: input.actor,
        owner: input.owner,
        creator: input.creator,
        tool: input.tool,
        program: PROGRAM,
        args,
        cwd: options?.cwd ?? input.root,
        operation: HostRequestKey.make(`${input.key}/${taken}`),
        subject: `git ${verbOf(args)}`,
        bytes: options?.capture ?? input.bytes,
        stdin,
        environment: environmentOf(options),
      });
      if (ending._tag === 'Refused') {
        const refusal = terminalRefusal(ending.refusal);
        return yield* new GitNotAdmitted({ command: args, code: refusal.code, reason: refusal.reason, unblock: refusal.unblock });
      }
      if (ending._tag === 'Unrun') {
        return yield* new GitUnavailable({ command: args, reason: ending.said });
      }
      if (ending._tag !== 'Ended') {
        return yield* new GitEndingUnreadable({ command: args, reason: ending.said });
      }
      return {
        status: ending.exitCode,
        stdout: ending.stdout.text,
        stderr: ending.stderr.text,
        overflow: ending.stdout.gap,
        messageOverflow: ending.stderr.gap,
      } satisfies GitAnswer;
    }),
  };
};

const verbOf = (args: readonly string[]): string => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '-C' || arg === '--git-dir' || arg === '--work-tree') {
      index += 1;
      continue;
    }
    if (!arg.startsWith('-')) return arg;
  }
  return '';
};
