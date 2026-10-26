import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { versionProblem } from '@tagma/inspection/node/runners/version';
import { Effect, FileSystem, Schema } from 'effect';
import { filesFailed } from './filesRunner.js';

const Manifest = Schema.Struct({ version: Schema.NonEmptyString });

export const requireVersion = Effect.fn('enforcement.program.requireVersion')(function* (path: string, tool: string, minimum: string) {
  const manifest = yield* Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const text = yield* files.readFileString(path);
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest))(text);
  }).pipe(
    Effect.mapError((error) => filesFailed(tool, `${path}: ${error.message}`)),
    Effect.provide(BunFileSystem.layer),
  );
  const unsupported = versionProblem(tool, manifest.version, minimum);
  if (unsupported !== null) return yield* filesFailed(tool, unsupported);
});
