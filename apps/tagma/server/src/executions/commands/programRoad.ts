import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { ProgramEnding, ProgramLaunch, ProgramRoad } from '../contract/service/programs.js';
import type { CommandCreator } from '../contract/wire/commands.js';
import type { CommandSubject } from '../contract/wire/commandSubject.js';
import type { TerminalActor } from '../contract/wire/terminals.js';
import { admittedCommand, type AdmittedEnding } from './admitted.js';
import type { CommandAccess } from '../contract/service/access.js';
import type { TerminalTargets } from '../contract/service/targets.js';
import type { ManagedCommands } from '../contract/service/commands.js';
import type { Terminals } from '../contract/service/terminals.js';

const OUTPUT_BYTES = 8 * 1024 * 1024;

const word = (text: string): string => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`);

const MISSING_MARK = 'tagma-program-missing:';

const MISSING_EXIT = 127;

const ownership = (actor: TerminalActor): { readonly owner: CommandSubject; readonly creator: CommandCreator } =>
  actor._tag === 'Thread'
    ? { owner: { _tag: 'Thread', thread: actor.threadId }, creator: { _tag: 'Thread', thread: actor.threadId } }
    : { owner: { _tag: 'Operator' }, creator: { _tag: 'Operator' } };

const missingOf = (ending: AdmittedEnding): string | null => {
  if (ending._tag !== 'Ended' || ending.exitCode !== MISSING_EXIT) return null;
  const at = ending.stderr.text.lastIndexOf(MISSING_MARK);
  return at === -1 ? null : (ending.stderr.text.slice(at + MISSING_MARK.length).split('\n')[0] ?? '');
};

const endingOf = (ending: AdmittedEnding, argv0: string): ProgramEnding => {
  const missing = missingOf(ending);
  if (missing !== null) return { _tag: 'Unrun', said: `${argv0} was not found or is not executable`, missing };
  if (ending._tag === 'Ended') {
    return { _tag: 'Exited', exitCode: ending.exitCode, stdout: ending.stdout.text, stderr: ending.stderr.text, cut: ending.stdout.gap };
  }
  if (ending._tag === 'Unread')
    return { _tag: 'Stopped', late: ending.cancelled === 'timeout', said: ending.said, stderr: ending.stderr.text };
  return { _tag: 'Unrun', said: ending.said };
};

const writtenInto = async (file: string, text: string): Promise<void> => writeFile(file, text, { mode: 0o600 });

const staged = (stdin: string, operands: readonly string[]) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const folder = await mkdtemp(join(tmpdir(), 'tagma-program-'));
        const file = join(folder, 'input.json');
        const listed = join(folder, 'operands');
        const ended = join(folder, 'ended');
        try {
          await writtenInto(file, stdin);
          if (operands.length > 0) await writtenInto(listed, operands.map((operand) => `${operand}\0`).join(''));
        } catch (failure) {
          try {
            await rm(folder, { recursive: true, force: true });
          } catch (cleanup) {
            throw new AggregateError([failure, cleanup], 'program input staging and release failed');
          }
          throw failure;
        }
        return { folder, file, listed, ended };
      },
      catch: (cause) => new Error(`program input could not be staged: ${String(cause)}`),
    }),
    ({ folder }) => Effect.promise(() => rm(folder, { recursive: true, force: true })),
  );

const execution = (
  argv: readonly string[],
  operands: number,
  at: { readonly file: string; readonly listed: string; readonly ended: string },
): string => {
  if (operands === 0) return `exec ${argv.map(word).join(' ')} < ${word(at.file)}`;
  const each = `"$@" <&3; c=$?; [ $c -eq 0 ] || [ -s "$0" ] || printf %s "$c" > "$0"`;
  return [
    `exec 3< ${word(at.file)}`,
    `xargs -0 sh -c ${word(each)} ${word(at.ended)} ${argv.map(word).join(' ')} < ${word(at.listed)}`,
    'x=$?',
    `[ $x -eq 0 ] || exit $x`,
    `[ -s ${word(at.ended)} ] && exit "$(cat ${word(at.ended)})"`,
    'exit 0',
  ].join('; ');
};

export const terminalProgramRoad = (
  terminals: Terminals['Service'],
  commands: ManagedCommands['Service'],
  access: CommandAccess['Service'],
  targets: TerminalTargets['Service'],
  shell: string,
): ProgramRoad['Service'] => ({
  run: Effect.fnUntraced(function* (launch: ProgramLaunch) {
    const env = Object.entries(launch.env ?? {});
    if (env.some(([name]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
      return { _tag: 'Unrun', said: 'a program environment variable has an invalid name' } as const;
    const exported = env.map(([name, value]) => `export ${name}=${word(value)}; `).join('');
    const head = word(launch.argv[0]);
    const found = launch.argv[0].includes('/') ? `[ -f ${head} ] && [ -x ${head} ]` : `command -v ${head} >/dev/null 2>&1`;
    const present = `${found} || { printf '${MISSING_MARK}%s\\n' "$PATH" >&2; exit ${MISSING_EXIT}; }; `;
    const operands = launch.operands ?? [];
    const stagedInput = yield* Effect.result(staged(launch.stdin, operands));
    if (stagedInput._tag === 'Failure') return { _tag: 'Unrun', said: stagedInput.failure.message } as const;
    const ending = yield* admittedCommand({
      terminals,
      commands,
      access,
      targets,
      projectId: launch.actor._tag === 'Operator' ? launch.projectId : launch.actor.projectId,
      actor: launch.actor,
      ...ownership(launch.actor),
      tool: launch.tool ?? 'inspection',
      program: shell,
      args: ['-c', `${exported}${present}${execution(launch.argv, operands.length, stagedInput.success)}`],
      cwd: launch.cwd,
      policyRoot: launch.policyRoot,
      operation: HostRequestKey.make(launch.operation),
      subject: launch.subject,
      bytes: OUTPUT_BYTES,
    });
    return endingOf(ending, launch.argv[0]);
  }, Effect.scoped),
});
