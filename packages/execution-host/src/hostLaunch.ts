import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { join } from 'node:path';
import { Duration, Effect, FileSystem, Schedule, Schema } from 'effect';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunServices from '@effect/platform-bun/BunServices';
import { HostLauncher } from '@runlith/executions/HostLauncher';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { HostBoot } from '@runlith/executions/protocol/boot';

const readBoot = Schema.decodeUnknownEffect(Schema.fromJsonString(HostBoot));

const ENTRY = join(import.meta.dir, 'main.ts');
const HOLDER = join(import.meta.dir, '../native/target/release/execution-holder');

export const hostLaunch = Effect.fnUntraced(function* (path: string) {
  const files = yield* FileSystem.FileSystem;
  const boot = yield* readBoot(yield* files.readFileString(path));
  const launcher = yield* HostLauncher.make(
    { state: boot.registration.state, installation: boot.registration.installation },
    'custodian',
    boot.limits,
    { handshakeMs: 5_000 },
  );
  const launched = yield* launcher.launch(
    {
      program: HOLDER,
      args: [boot.registration.state, process.execPath, ENTRY, path],
      environment: {
        ...(process.env.PATH !== undefined ? { PATH: process.env.PATH } : {}),
        ...(process.env.HOME !== undefined ? { HOME: process.env.HOME } : {}),
        ...(process.env.TMPDIR !== undefined ? { TMPDIR: process.env.TMPDIR } : {}),
      },
    },
    Schedule.upTo(Schedule.spaced(Duration.millis(25)), { duration: Duration.seconds(5) }),
  );
  yield* Effect.sync(() => process.stdout.write(`${launched._tag}\n`));
  return launched;
});

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.scoped(hostLaunch(process.argv[2] ?? '')).pipe(
      Effect.provide(HostRegistration.layer),
      Effect.provide(endpointConnection),
      Effect.provide(BunServices.layer),
    ),
  );
}
