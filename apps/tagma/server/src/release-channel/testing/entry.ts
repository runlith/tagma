import { resolve } from 'node:path';
import { Effect } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { installationRoot, launcherPath } from '../../installation/paths.js';
import { CHANNELS } from '../../installation/contract/wire/channel.js';
import { installRelease } from '../install.js';
import { serverless, trustedApplications } from './release.js';

const [verb, ...rest] = process.argv.slice(2);
const channel = CHANNELS.stable;

if (verb === 'install-from') {
  const landed = await Effect.runPromise(
    Effect.result(
      installRelease(
        resolve(rest.at(-1) ?? '.'),
        { installRoot: installationRoot(channel), launcher: launcherPath(channel), name: channel.name },
        trustedApplications,
        new Date(),
        false,
        serverless,
      ),
    ).pipe(Effect.provide(BunFileSystem.layer)),
  );
  if (landed._tag === 'Failure') {
    console.error(`refused at ${landed.failure.step}: ${landed.failure.reason}`);
    process.exit(2);
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
