import * as BunServices from '@effect/platform-bun/BunServices';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { join } from 'node:path';
import { kind, shared } from '@runlith/testbed/worlds';
import { ARTIFACT_FILE } from '@runlith/executions/protocol/artifact';
import { cachedArtifact, type Placed } from '../../buildArtifact';
import { HOLDER_BINARY, HOLDER_LIBRARY } from '../../posix/testing/holder';

export class Bundle extends Context.Service<Bundle, Placed>()('testing/ExecutionBundle') {}
export const bundleWorld = kind(Bundle, (_params: null, home) =>
  cachedArtifact({
    root: join(home, 'bundle'),
    source: join(import.meta.dir, '../../..'),
    library: HOLDER_LIBRARY,
    holder: HOLDER_BINARY,
    build: 'testing',
    bundling: { comments: 'none', minify: true, sourcemap: 'none' },
  }).pipe(Effect.provide(BunServices.layer)),
);

export const bundleFixture = Layer.effect(Bundle, shared(bundleWorld, null));

export const copyBundle = Effect.fn('testing.ExecutionBundle.copy')(function* (root: string, build: string) {
  const files = yield* FileSystem.FileSystem;
  const built = yield* shared(bundleWorld, null);
  yield* files.copy(built.root, root);
  const manifest = { ...built.manifest, identity: { ...built.manifest.identity, build } };
  yield* files.writeFileString(join(root, ARTIFACT_FILE), JSON.stringify(manifest));
  return { ...built, root, manifest };
}, Effect.provide(BunServices.layer));
