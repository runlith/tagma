import { expect } from 'bun:test';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Clock, Context, Data, Effect, FileSystem, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { releasesNewestFirst } from '../../../installation/closure/versions.js';
import { applications } from '../../../mac-applications/placement.js';
import { installRelease, type InstallPlace } from '../../../release-channel/install.js';
import { carriedIn, serverless, signedBundle, syntheticReleaseEffect } from '../../../release-channel/testing/release.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { fixtureHome } from '../../../platform/testing/roots.js';

const QUARANTINE = 'com.apple.quarantine';
const setup = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ directory: fixtureHome(), prefix: 'tagma-application-copy-' }));
  const root = join(home, '.tagma/install');
  yield* files.makeDirectory(root, { recursive: true });
  const place: InstallPlace = { installRoot: root, launcher: join(home, '.tagma/bin/tagma'), name: 'Tagma' };
  return { home, place };
});
class CopyPlace extends Context.Service<CopyPlace, Effect.Success<typeof setup>>()('testing/CopyPlace') {}
class ApplicationFixtureRefused extends Data.TaggedError('ApplicationFixtureRefused')<{ readonly path: string; readonly cause: unknown }> {
  override readonly message = `${this.path}: ${String(this.cause)}`;
}
const quarantined = Effect.fn('applicationFixture.quarantine')(function* (path: string) {
  const read = yield* spawnedEffect(['/usr/bin/xattr', path]);
  if (!read.success) return yield* new ApplicationFixtureRefused({ path, cause: read.stderr.toString() });
  return read.stdout.toString().trim().split('\n').includes(QUARANTINE);
});
const downloaded = Effect.fn('applicationFixture.download')(function* (home: string, name: string, build: string) {
  const bundle = join(home, name, 'Tagma.app');
  yield* syntheticReleaseEffect(bundle, build);
  yield* Effect.try({ try: () => signedBundle(bundle), catch: (cause) => new ApplicationFixtureRefused({ path: bundle, cause }) });
  const marked = yield* spawnedEffect(['/usr/bin/xattr', '-w', '-r', QUARANTINE, '0083;6720f3a1;Safari;', bundle]);
  if (!marked.success) return yield* new ApplicationFixtureRefused({ path: bundle, cause: marked.stderr.toString() });
  return bundle;
});

layer(Layer.effect(CopyPlace, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'install-from on macOS',
  (it) => {
    it.effect(
      'a signed application that came quarantined is copied into its release and only the copies leave quarantine; one whose seal broke after signing is refused before anything is copied',
      () =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { home, place } = yield* CopyPlace;
          const bundle = yield* downloaded(home, 'Downloads', '0.1.0');
          const landed = yield* installRelease(
            carriedIn(bundle),
            place,
            applications,
            new Date(yield* Clock.currentTimeMillis),
            false,
            serverless,
          );
          if (landed.status !== 'landed') return yield* Effect.die(landed.status === 'ask' ? landed.said : landed.detail);
          expect(yield* quarantined(join(bundle, 'Contents/Info.plist'))).toBe(true);
          expect(yield* quarantined(join(landed.application, 'Contents/Info.plist'))).toBe(false);
          expect(yield* quarantined(join(landed.root, 'install.json'))).toBe(false);
          const broken = yield* downloaded(home, 'Broken', '0.2.0');
          yield* files.writeFileString(join(carriedIn(broken), 'surface/index.html'), '<p>changed after signing</p>\n');
          const refused = yield* Effect.result(
            installRelease(carriedIn(broken), place, applications, new Date(yield* Clock.currentTimeMillis), false, serverless),
          );
          expect(refused).toMatchObject({ _tag: 'Failure', failure: { step: 'signature' } });
          expect(
            yield* Effect.try({
              try: () => releasesNewestFirst(place.installRoot).length,
              catch: (cause) => new ApplicationFixtureRefused({ path: place.installRoot, cause }),
            }),
          ).toBe(1);
        }),
    );

    it.effect('clearing the previous application placement keeps the application and removes its staging siblings and record', () =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const { home, place } = yield* CopyPlace;
        const placed = join(home, 'Applications', 'Tagma.app');
        const beside = (part: string) => join(home, 'Applications', `.Tagma.app.${part}`);
        const paths = [placed, ...['next', 'prev', 'lock'].map(beside), join(place.installRoot, 'application')];
        yield* Effect.forEach(paths.slice(0, 4), (at) => files.makeDirectory(at, { recursive: true }), { discard: true });
        yield* files.writeFileString(join(place.installRoot, 'application'), `${placed}\n`);
        yield* Effect.try({
          try: () => applications.clearPlace(place.installRoot),
          catch: (cause) => new ApplicationFixtureRefused({ path: place.installRoot, cause }),
        });
        expect(yield* Effect.forEach(paths, (at) => files.exists(at))).toEqual([true, false, false, false, false]);
      }),
    );
  },
);
