import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { executableIn, platformOf, RELEASE } from '@runlith/chrome-for-testing/build';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect, FileSystem, Layer } from 'effect';
import { agentIn, browserWorld, calling, PAGE, refusalOf } from '../browser/testing/world.js';
import { MANAGED_AGENT } from './adapter.js';
import { managedTestHost, testAdapter } from './testing/host.js';

const fixture = Layer.unwrap(
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'managed-startup-' });
    const platform = platformOf(process.platform, process.arch);
    if (platform === null) return yield* Effect.die('the startup test needs a published Chrome for Testing platform');
    const builds = join(home, 'builds');
    const executable = executableIn(join(builds, 'chrome-for-testing', RELEASE), platform);
    yield* files.makeDirectory(join(executable, '..'), { recursive: true });
    yield* files.writeFileString(
      executable,
      `#!/bin/sh
if [ "$1" = --version ]; then
  printf 'Chrome for Testing ${RELEASE}\\n'
  exit 0
fi
printf 'sandbox setup refused: fixture diagnostic\\n' >&2
exit 1
`,
    );
    yield* files.chmod(executable, 0o700);
    return browserWorld({ home, adapters: [testAdapter], host: managedTestHost(home, { builds }) });
  }),
).pipe(Layer.provide(BunFileSystem.layer));

layer(fixture, { excludeTestServices: true })('managed browser startup', (it) => {
  it.effect('an exited browser refuses the opening with its own diagnostic instead of an unknown page outcome', () =>
    Effect.gen(function* () {
      const refusal = yield* refusalOf(
        calling(PAGE.open_page.body.execute({ url: 'about:blank', profile: MANAGED_AGENT }, undefined, agentIn(import.meta.dir))),
      );
      expect(refusal.code).toBe('host-refused');
      expect(refusal.reason).toContain('sandbox setup refused: fixture diagnostic');
    }),
  );
});
