import { expect } from 'bun:test';
import { fileURLToPath } from 'node:url';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { bundle } from '@runlith/bundle/bundle';
import { layer } from '@runlith/effect-test';
import { Git, gitLayer } from '@runlith/git/Git';
import { Effect, FileSystem, Layer } from 'effect';

const ENTRY = fileURLToPath(new URL('./testing/bundled.ts', import.meta.url));

const host = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const world = Layer.mergeAll(BunFileSystem.layer, gitLayer.pipe(Layer.provide(host)));

layer(world, { excludeTestServices: true })('the config read by a release bundle', (it) => {
  it.effect('a minified bundle that also loads the SDK doors as code reads tagma.config.ts from the doors carried beside it', () =>
    Effect.gen(function* () {
      const disk = yield* FileSystem.FileSystem;
      const git = yield* Git;
      const out = yield* disk.realPath(yield* disk.makeTempDirectoryScoped({ prefix: 'config-bundle-' }));
      const closure = yield* bundle(ENTRY, 'entry.js', { minify: true, comments: 'none' });
      for (const one of closure) yield* disk.writeFileString(`${out}/${one.name}`, one.text);

      const root = yield* disk.realPath(yield* disk.makeTempDirectoryScoped({ prefix: 'config-repo-' }));
      yield* disk.writeFileString(
        `${root}/tagma.config.ts`,
        [
          `import { defineConfig, Loading } from '@runlith/tagma/rules';`,
          `import { Effect } from '@runlith/tagma/rules/effect';`,
          `export default defineConfig({ inspections: {`,
          `  'domain-no-ui': Loading.forbid({ from: ['packages/domain'], refuses: ['react'] }),`,
          `  failures: Effect.noSwallowedFailures({ region: ['src/'], allow: [] }),`,
          `} });`,
        ].join('\n'),
      );
      for (const args of [
        ['init', '-q'],
        ['add', '-A'],
        ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'config'],
      ])
        yield* git.run(args, { cwd: root });

      const ran = Bun.spawnSync([process.execPath, '--no-install', `${out}/entry.js`, root], { cwd: out, stdout: 'pipe', stderr: 'pipe' });
      expect(ran.stderr.toString()).toBe('');
      const said = JSON.parse(ran.stdout.toString().trim().split('\n').at(-1)!);
      expect(said.answer.inspections['domain-no-ui']).toMatchObject({ builtin: 'loads', params: { from: ['packages/domain'] } });
      expect(said.answer.inspections.failures).toMatchObject({ builtin: 'swallowed-failures', params: { region: ['src/'] } });
    }),
  );
});
