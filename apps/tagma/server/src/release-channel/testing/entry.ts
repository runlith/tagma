import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { installationRoot, launcherPath } from '../../installation/paths.js';
import { CHANNELS } from '../../installation/contract/wire/channel.js';
import { installRelease } from '../install.js';
import { serverless, trustedApplications } from './release.js';
import type { ServerCli } from '../../installation/cli/port.js';

const [verb, ...rest] = process.argv.slice(2);
const channel = CHANNELS.stable;

if (process.env.TAGMA_TEST_CLI_JSON === '1') {
  const [{ invoke }, { installFrom }, { InstalledChannel }, { processInvocation }, BunServices] = await Promise.all([
    import('../../cli/invoke.js'),
    import('../cli.js'),
    import('../../installation/contract/service/channel.js'),
    import('../../platform/cli/verb.js'),
    import('@effect/platform-bun/BunServices'),
  ]);
  const unused = () => Effect.die('the installation CLI fixture has no other server operation');
  const noAddress = (): never => {
    throw new Error('the installation CLI fixture has no server address');
  };
  const cli: ServerCli = {
    perform: unused,
    ask: (call) =>
      call({ operations: { perform: () => Effect.succeed({ status: 'checked', verdict: 'unasked', detail: null }) } }, processInvocation()),
    baseUrl: noAddress,
    boundAddress: noAddress,
    boundHere: noAddress,
    health: unused,
    healthOrNone: unused,
    startup: unused,
    here: (at) => ({ cwd: at.cwd }),
    lens: noAddress,
  };
  const applications = {
    ...trustedApplications,
    forget: () => {
      if (process.env.TAGMA_TEST_PRUNE_ENTRY !== undefined) writeFileSync(process.env.TAGMA_TEST_PRUNE_ENTRY, 'refused');
      throw new Error('the old application could not be unregistered');
    },
  };
  const code = await Effect.runPromise(
    invoke(process.argv.slice(2), { 'install-from': async () => ({ installFrom: installFrom(cli, applications) }) }, 'test').pipe(
      Effect.provideService(InstalledChannel, channel),
      Effect.provide(BunServices.layer),
    ),
  );
  process.exit(code);
}

if (verb === 'install-from') {
  if (process.env.TAGMA_TEST_INSTALL_ENTRY !== undefined) writeFileSync(process.env.TAGMA_TEST_INSTALL_ENTRY, 'entered');
  const landed = await Effect.runPromise(
    Effect.result(
      installRelease(
        resolve(rest.at(-1) ?? '.'),
        { installRoot: installationRoot(channel), launcher: launcherPath(channel), name: channel.name },
        trustedApplications,
        new Date(),
        false,
        process.env.TAGMA_TEST_HOST_REFUSAL === undefined
          ? serverless
          : () => Effect.succeed({ _tag: 'Refuses', detail: process.env.TAGMA_TEST_HOST_REFUSAL! }),
      ),
    ).pipe(Effect.provide(BunFileSystem.layer)),
  );
  if (landed._tag === 'Failure') {
    console.error(`refused at ${landed.failure.step}: ${landed.failure.reason}`);
    process.exit(2);
  }
  if (rest.includes('--json')) {
    console.log(JSON.stringify(landed.success));
    process.exit(0);
  }
  if (landed.success.status === 'ask') {
    console.error(`asked: ${landed.success.said}`);
    process.exit(2);
  }
  console.log(`installed ${landed.success.build} in ${landed.success.root}`);
} else {
  console.error(`the synthetic release runs install-from alone, not ${verb ?? 'nothing'}`);
  process.exit(2);
}
