import { Effect, FileSystem, Runtime, Schema } from 'effect';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunServices from '@effect/platform-bun/BunServices';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { HostBoot } from '@runlith/executions/protocol/boot';
import { BootRefused } from './boot';
import { serve } from './composition/host';
import { holderLayer } from './composition/platform';

const readBoot = Schema.decodeUnknownEffect(Schema.fromJsonString(HostBoot));

export const bootFile = (argv: ReadonlyArray<string>): Effect.Effect<string, BootRefused> => {
  const given = argv.slice(2);
  return given.length === 1 && given[0] !== undefined && given[0].length > 0
    ? Effect.succeed(given[0])
    : Effect.fail(new BootRefused({ detail: 'expected exactly one argument: the path of the boot file' }));
};

export const main = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const path = yield* bootFile(process.argv);
  const text = yield* files
    .readFileString(path)
    .pipe(
      Effect.catchTag('PlatformError', (error) =>
        Effect.fail(new BootRefused({ detail: `the boot file could not be read: ${error.reason._tag}` })),
      ),
    );
  const boot = yield* readBoot(text).pipe(
    Effect.catchTag('SchemaError', (error) => Effect.fail(new BootRefused({ detail: error.message }))),
  );
  return yield* serve(boot, { telemetry: {} }).pipe(Effect.provide(holderLayer(boot.library)));
}).pipe(
  Effect.scoped,
  Effect.provide(HostRegistration.layer),
  Effect.provide(BunServices.layer),
  Effect.catchTag('BootRefused', (error) => Effect.die(new Error(`BootRefused: ${error.detail}`))),
);

if (import.meta.main) {
  BunRuntime.runMain(main, { teardown: (exit) => Runtime.defaultTeardown(exit, (code) => process.exit(code)) });
}
