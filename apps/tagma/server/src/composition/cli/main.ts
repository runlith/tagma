import { Effect } from 'effect';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunServices from '@effect/platform-bun/BunServices';
import { invoke } from '../../cli/invoke.js';
import { holdingProcess, holdVersion } from '../../installation/closure/leases.js';
import { InstalledChannel } from '../../installation/contract/service/channel.js';
import type { VerbSources } from '../../platform/cli/verb.js';
import { PROGRAM_RELEASE } from '../../platform/contract/wire/program.js';
import type { Build } from '../build.js';
import { ENTERED, NOT_RUNNING } from '../../installation/contract/wire/junction.js';
import { enteredActive } from '../../installation/setup/active.js';
import { type CliEnvironment, cliEnvironment } from './environment.js';

export const runCli = (build: Build, server: () => Promise<unknown>): void => {
  const installed = holdingProcess(process.execPath);
  if (installed !== null) holdVersion(installed);
  const argv = process.argv.slice(2);
  const entered = process.env[ENTERED] === '1';
  delete process.env[ENTERED];
  const performed = Effect.fnUntraced(function* <R>(verbs: () => Promise<VerbSources<R>>) {
    const code = yield* invoke(argv, yield* Effect.promise(verbs), PROGRAM_RELEASE);
    if (code !== 0) yield* Effect.sync(() => process.exit(code));
  });
  const hook = performed(() => import('./hookVerbs.js').then(({ hookVerbs }) => hookVerbs(build.channel)));
  const program: Effect.Effect<void, never, CliEnvironment> =
    argv[0] === 'hook' ? hook : performed(() => import('./verbs.js').then((verbs) => verbs.verbsOf(build, server)));
  const routed = entered
    ? Effect.flatMap(enteredActive(build.channel, process.env), (active) =>
        active
          ? program
          : Effect.sync(() => {
              if (argv[0] !== 'hook') console.error(NOT_RUNNING);
              process.exit(argv[0] === 'hook' ? 0 : 1);
            }),
      )
    : program;
  BunRuntime.runMain(
    entered || argv[0] !== 'hook'
      ? routed.pipe(Effect.provide(cliEnvironment(build.channel, build.cut.roots.packages)))
      : hook.pipe(Effect.provideService(InstalledChannel, build.channel), Effect.provide(BunServices.layer)),
  );
};
