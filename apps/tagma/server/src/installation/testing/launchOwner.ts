import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context, Effect, Layer } from 'effect';
import { Processes } from '@runlith/execution-host/ProcessReader';
import { ServerLaunch } from '../process/launch.js';
import { testProcesses } from './processes.js';

const home = process.env.LAUNCH_TEST_HOME;
if (home === undefined) throw new Error('LAUNCH_TEST_HOME is required');
const server = fileURLToPath(new URL('./launchServer.ts', import.meta.url));
process.exitCode = await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const native = yield* Layer.build(testProcesses);
      const launch = new ServerLaunch([process.execPath, server], process.env, join(home, 'serve.log'), Context.get(native, Processes));
      return yield* Effect.promise(() => launch.exited);
    }),
  ),
);
