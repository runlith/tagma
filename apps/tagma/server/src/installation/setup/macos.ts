import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { type MachinePlatform, PlatformUnreadable } from '../contract/service/platform.js';

const run = promisify(execFile);

export const macPlatform: MachinePlatform = {
  current: Effect.tryPromise({
    try: (signal) => run('/usr/sbin/sysctl', ['-in', 'hw.optional.arm64'], { signal, encoding: 'utf8' }),
    catch: (error) =>
      new PlatformUnreadable({ reason: `the machine's architecture could not be read with sysctl hw.optional.arm64: ${String(error)}` }),
  }).pipe(
    Effect.flatMap(({ stdout }) => {
      const arm64 = stdout.trim();
      return arm64 === '1' || arm64 === '0' || arm64 === ''
        ? Effect.succeed({ os: 'darwin', arch: arm64 === '1' ? 'arm64' : 'x64' })
        : Effect.fail(
            new PlatformUnreadable({ reason: `sysctl hw.optional.arm64 answered ${JSON.stringify(arm64)}, which names no architecture` }),
          );
    }),
    Effect.withSpan('installation.machinePlatform'),
  ),
};
