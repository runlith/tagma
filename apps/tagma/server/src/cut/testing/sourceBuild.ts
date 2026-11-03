import { join } from 'node:path';
import { Effect } from 'effect';
import { testProcesses } from '../../installation/testing/processes.js';
import { build } from '../build.js';
import { runCut } from '../command.js';
import { CHANNELS } from '../../installation/contract/wire/channel.js';
import { BUILD_SOURCE_ENV } from '../../installation/contract/wire/layout.js';
import type { BuildServer } from '../port.js';
import { releaseSource } from '../entry.js';
import type { Distribution } from '../descriptor.js';

const unused: BuildServer = {
  ask: () => Effect.die('the fixture does not contact a running server'),
  healthOrNone: () => Effect.die('the fixture does not contact a running server'),
  startup: () => Effect.die('the fixture does not restart a running server'),
  boundHere: () => false,
  baseUrl: () => 'http://127.0.0.1:1',
};

const runProducer = async (root: string): Promise<void> => {
  const command = await Bun.file(join(root, 'build.command')).text();
  const child = Bun.spawn(['sh', '-c', command], { cwd: root, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' });
  process.exitCode = await child.exited;
};

export const runSourceBuild = async (root: string, args: readonly string[]): Promise<void> => {
  if (process.env[BUILD_SOURCE_ENV] === root) return runProducer(root);
  await runCut(
    build(unused, args, {
      channel: CHANNELS.dev,
      checkout: root,
      inputs: process.env.SOURCE_INPUTS?.split('\n').filter((path) => path !== '') ?? [],
      composition: Effect.die('a source build evaluates its captured entry instead of the working composition'),
    }).pipe(Effect.provide(testProcesses)),
  );
};

export const runSourceRelease = async (root: string, args: readonly string[]): Promise<void> => {
  const unread = () => Effect.die('the source fixture has no native application');
  const distribution: Distribution = {
    conditions: [],
    applications: {
      kept: (at, name) => join(at, 'desktop', name),
      inside: (application) => join(application, 'release'),
      carrier: () => null,
      carried: () => null,
      verify: unread,
      copy: unread,
      unquarantine: unread,
      forget: () => undefined,
      signature: unread,
    },
    roots: { checkout: root, server: root, packages: root, desktop: root },
    entries: { cli: join(root, 'release.ts'), server: join(root, 'producer.ts') },
    client: { root, config: null },
    brand: { assets: root },
    signing: { team: null, notary: 'unused' },
    plugins: [],
    feed: null,
    publisher: null,
    workshop: CHANNELS.dev,
  };
  await runCut(
    releaseSource(
      args,
      distribution,
      Effect.promise(() => runProducer(root)),
    ),
  );
};
