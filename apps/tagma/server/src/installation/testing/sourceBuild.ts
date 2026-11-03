import { join } from 'node:path';
import { Effect } from 'effect';
import { testProcesses } from './processes.js';
import { build } from '../cut/build.js';
import { runCut } from '../cut/command.js';
import { CHANNELS } from '../contract/wire/channel.js';
import { BUILD_SOURCE_ENV } from '../contract/wire/layout.js';
import type { BuildServer } from '../cut/port.js';

const unused: BuildServer = {
  ask: () => Effect.die('the fixture does not contact a running server'),
  healthOrNone: () => Effect.die('the fixture does not contact a running server'),
  startup: () => Effect.die('the fixture does not restart a running server'),
  boundHere: () => false,
  baseUrl: () => 'http://127.0.0.1:1',
};

export const runSourceBuild = async (root: string, args: readonly string[]): Promise<void> => {
  if (args.includes('--tree') || process.env[BUILD_SOURCE_ENV] === root) {
    const command = await Bun.file(join(root, 'build.command')).text();
    const child = Bun.spawn(['sh', '-c', command], { cwd: root, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' });
    process.exitCode = await child.exited;
    return;
  }
  await runCut(
    build(unused, args, {
      channel: CHANNELS.dev,
      checkout: root,
      composition: Effect.die('a HEAD build evaluates its committed entry instead of the working composition'),
    }).pipe(Effect.provide(testProcesses)),
  );
};
