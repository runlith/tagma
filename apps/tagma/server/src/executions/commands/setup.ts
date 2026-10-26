import { Effect } from 'effect';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { SetupLaunch, SetupEnding } from '../contract/wire/setup.js';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { admittedCommand, admittedWatch, type AdmittedCommand, type AdmittedEnding } from './admitted.js';
import { lastLines } from './outputTail.js';

const SETUP_TOOL = 'worktree_setup';

const SUBJECT = 'the worktree setup command';

const CONSOLE_BYTES = 16_384;

const TAIL_LINES = 5;

const OPERATOR = { _tag: 'Operator' } as const;

const endingOf = (ending: AdmittedEnding): SetupEnding => {
  if (ending._tag === 'Ended') {
    const stream = ending.stderr.text.trim() === '' ? ending.stdout : ending.stderr;
    return {
      _tag: 'Exited',
      execution: ending.execution,
      exitCode: ending.exitCode,
      tail: stream.gap ? '' : lastLines(stream.text.trimEnd(), TAIL_LINES),
    };
  }
  return { _tag: 'Unread', execution: 'execution' in ending ? ending.execution : null, said: ending.said };
};

export const setupCommands = (owners: Pick<AdmittedCommand, 'terminals' | 'commands' | 'access' | 'targets'>, shell: string) => ({
  run: (launch: SetupLaunch) =>
    Effect.map(
      admittedCommand({
        terminals: owners.terminals,
        commands: owners.commands,
        access: owners.access,
        targets: owners.targets,
        projectId: launch.projectId,
        actor: OPERATOR,
        owner: OPERATOR,
        creator: OPERATOR,
        tool: SETUP_TOOL,
        program: shell,
        args: ['-c', launch.command],
        cwd: launch.cwd,
        operation: HostRequestKey.make(launch.operation),
        subject: SUBJECT,
        bytes: CONSOLE_BYTES,
        purpose: 'command',
        started: launch.started,
      }),
      endingOf,
    ),
  watch: (projectId: number, execution: ExecutionRef) =>
    Effect.map(
      admittedWatch(
        {
          commands: owners.commands,
          access: owners.access,
          projectId,
          actor: OPERATOR,
          subject: SUBJECT,
          bytes: CONSOLE_BYTES,
        },
        execution,
      ),
      endingOf,
    ),
});
