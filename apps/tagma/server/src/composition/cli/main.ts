import { Effect, Layer } from 'effect';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunServices from '@effect/platform-bun/BunServices';
import { invoke } from '../../cli/invoke.js';
import { holdingProcess, holdVersion } from '../../installation/closure/leases.js';
import { InstalledChannel } from '../../installation/contract/service/channel.js';
import { PROGRAM_RELEASE } from '../../platform/contract/wire/program.js';
import type { Build } from '../build.js';
import { ownProcessesLayer } from '../children.js';
import { lockHoldersLayer } from '../hostClaims.js';
import { ENTERED, NOT_RUNNING } from '../../installation/contract/wire/junction.js';
import { enteredActive } from '../../installation/setup/active.js';

export const runCli = (build: Build, server: () => Promise<unknown>): void => {
  const installed = holdingProcess(process.execPath);
  if (installed !== null) holdVersion(installed);
  const argv = process.argv.slice(2);
  const entered = process.env[ENTERED] === '1';
  delete process.env[ENTERED];
  const verbsOf = () =>
    argv[0] === 'hook'
      ? import('./hookVerbs.js').then(({ hookVerbs }) => hookVerbs(build.channel))
      : import('./verbs.js').then((verbs) => verbs.verbsOf(build, server));
  const program = Effect.promise(verbsOf).pipe(
    Effect.flatMap((verbs) => invoke(argv, verbs, PROGRAM_RELEASE)),
    Effect.flatMap((code) => (code === 0 ? Effect.void : Effect.sync(() => process.exit(code)))),
    Effect.provideService(InstalledChannel, build.channel),
    Effect.provide(BunServices.layer),
  );
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
  const native = Layer.merge(ownProcessesLayer(build.cut.roots.packages), lockHoldersLayer);
  BunRuntime.runMain(entered || argv[0] !== 'hook' ? routed.pipe(Effect.provide(native)) : program);
};
