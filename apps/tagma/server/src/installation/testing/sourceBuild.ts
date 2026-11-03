import { join } from 'node:path';
import { Effect } from 'effect';
import { testProcesses } from './processes.js';
import { build } from '../cut/build.js';
import { runCut } from '../cut/command.js';
import { CHANNELS } from '../contract/wire/channel.js';
import { BUILD_SOURCE_ENV } from '../contract/wire/layout.js';
import type { BuildServer } from '../cut/port.js';
import { releaseSource } from '../cut/entry.js';
import type { Distribution } from '../cut/descriptor.js';

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
      inputs: ['skills/_probe-peer/SKILL.md'],
      composition: Effect.die('a source build evaluates its captured entry instead of the working composition'),
    }).pipe(Effect.provide(testProcesses)),
  );
};

export const runSourceRelease = async (root: string, args: readonly string[]): Promise<void> => {
  const unread = () => Effect.die('the source fixture has no native application');
  const distribution: Distribution = {
    conditions: [],
    applications: {
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
