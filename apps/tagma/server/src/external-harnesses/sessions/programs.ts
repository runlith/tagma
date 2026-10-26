import { Effect } from 'effect';
import type { EnvironmentEntry } from '@runlith/executions/protocol/execution';
import type { CommandEnvironmentRequest } from '@runlith/executions/CommandEnvironment';
import { WORLD_COMMAND } from '../../installation/contract/wire/layout.js';
import type { Terminals, TerminalStart } from '../../executions/contract/service/terminals.js';
import type { HarnessProgram, InstalledHarnesses } from '../../threads/contract/service/harness.js';
import { pathWith } from '../birth/installed.js';
import { HARNESS_PROGRAM } from '../contract/wire/program.js';

const RUNNER_VERB = 'harness-run';

const pathOf = (environment: CommandEnvironmentRequest): string => {
  const named = environment.entries.findLast((entry) => entry._tag === 'Set' && entry.name === 'PATH');
  return named?._tag === 'Set' ? named.value : environment.inherit ? (process.env.PATH ?? '') : '';
};

export const programEnvironment = (
  program: HarnessProgram,
  requested: CommandEnvironmentRequest | undefined,
  extra: readonly EnvironmentEntry[] = [],
): CommandEnvironmentRequest => {
  const environment = requested ?? { inherit: true, entries: [] };
  const paired: readonly EnvironmentEntry[] =
    program.runtime === null ? [] : [{ _tag: 'Set', name: 'PATH', value: pathWith(program.runtime, pathOf(environment)) }];
  return { inherit: environment.inherit, entries: [...environment.entries, ...paired, ...extra] };
};

export const harnessTerminals = (terminals: Terminals['Service'], installs: InstalledHarnesses['Service']): Terminals['Service'] => ({
  ...terminals,
  start: Effect.fn('harnessTerminals.start')(function* (request: TerminalStart) {
    const runner = request.program === WORLD_COMMAND && request.args[0] === RUNNER_VERB ? request.args[1] : undefined;
    if (runner !== undefined) {
      const program = yield* installs.program(runner, 'harness');
      if (program === null) return yield* terminals.start(request);
      return yield* terminals.start({
        ...request,
        environment: programEnvironment(program, request.environment, [{ _tag: 'Set', name: HARNESS_PROGRAM, value: program.path }]),
      });
    }
    const program = yield* installs.program(request.program);
    if (program === null) return yield* terminals.start(request);
    return yield* terminals.start({ ...request, program: program.path, environment: programEnvironment(program, request.environment) });
  }),
});
