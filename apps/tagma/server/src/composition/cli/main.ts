import { Effect } from 'effect';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunServices from '@effect/platform-bun/BunServices';
import { invoke } from '../../cli/invoke.js';
import { holdingProcess, holdVersion } from '../../installation/closure/leases.js';
import { InstalledChannel } from '../../installation/contract/service/channel.js';
import { PROGRAM_RELEASE } from '../../platform/contract/wire/program.js';
import type { Build } from '../build.js';

export const runCli = (build: Build, server: () => Promise<unknown>): void => {
  const installed = holdingProcess(process.execPath);
  if (installed !== null) holdVersion(installed);
  const argv = process.argv.slice(2);
  const verbsOf = () =>
    argv[0] === 'hook'
      ? import('./hookVerbs.js').then(({ hookVerbs }) => hookVerbs(build.channel))
      : import('./verbs.js').then((verbs) => verbs.verbsOf(build, server));
  BunRuntime.runMain(
    Effect.promise(verbsOf).pipe(
      Effect.flatMap((verbs) => invoke(argv, verbs, PROGRAM_RELEASE)),
      Effect.flatMap((code) => (code === 0 ? Effect.void : Effect.sync(() => process.exit(code)))),
      Effect.provideService(InstalledChannel, build.channel),
      Effect.provide(BunServices.layer),
    ),
  );
};
