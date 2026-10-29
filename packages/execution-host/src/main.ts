import { Effect, FileSystem, Runtime, Schema } from 'effect';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunServices from '@effect/platform-bun/BunServices';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { HostBoot, loadRefusalOf } from '@runlith/executions/protocol/boot';
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

const causeOf = (failure: { readonly _tag: string; readonly message: string }): string =>
  failure.message.length > 0 ? `${failure._tag}: ${failure.message}` : failure._tag;

const fell = (files: FileSystem.FileSystem, boot: string, cause: string): Effect.Effect<void> => {
  const refusal = loadRefusalOf(boot);
  const draft = `${refusal}.${process.pid}`;
  const published = files.writeFileString(draft, `${cause}\n`, { mode: 0o600 }).pipe(Effect.andThen(files.rename(draft, refusal)));
  return Effect.flatMap(Effect.result(published), (written) =>
    written._tag === 'Failure'
      ? Effect.andThen(
          Effect.logError(`the refusal of this logic's load could not be published: ${cause}`, written.failure),
          Effect.flatMap(Effect.result(files.remove(draft, { force: true })), (removed) =>
            removed._tag === 'Failure' ? Effect.logError(`the draft ${draft} could not be removed`, removed.failure) : Effect.void,
          ),
        )
      : Effect.void,
  );
};

const loaded = Effect.fnUntraced(function* (files: FileSystem.FileSystem, path: string) {
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
});

export const main = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const path = yield* bootFile(process.argv);
  yield* Effect.flatMap(Effect.result(files.remove(loadRefusalOf(path), { force: true })), (removed) =>
    removed._tag === 'Failure'
      ? Effect.logError('the load refusal of the logic before this one could not be removed', removed.failure)
      : Effect.void,
  );
  return yield* loaded(files, path).pipe(Effect.tapError((failure) => fell(files, path, causeOf(failure))));
}).pipe(
  Effect.scoped,
  Effect.provide(HostRegistration.layer),
  Effect.provide(BunServices.layer),
  Effect.catchTag('BootRefused', (error) => Effect.die(new Error(`BootRefused: ${error.detail}`))),
);

if (import.meta.main) {
  BunRuntime.runMain(main, { teardown: (exit) => Runtime.defaultTeardown(exit, (code) => process.exit(code)) });
}
