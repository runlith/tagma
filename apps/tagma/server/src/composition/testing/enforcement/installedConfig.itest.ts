import { layer } from '@runlith/effect-test';
import { describe, expect } from 'bun:test';
import { Effect, FileSystem } from 'effect';
import { join } from 'node:path';
import type { Inspection, Params } from '@tagma/inspection/builtins';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { TRIGGERS } from '../../../graph/testing/triggers.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { checksIn } from '../../../enforcement/testing/wiring.js';
import { LAYERED } from '../../../enforcement/testing/layered.js';
import { gitEffect } from '../graphFixture.js';
import { enforceFixture, withEnforcement, type EnforcementFixture } from './enforceFixture.js';

const ROOTED: Inspection = { builtin: 'modules', params: { ...(LAYERED.params as Params<'modules'>), base: '' } };
const LOADING: Inspection = {
  builtin: 'platforms',
  params: {
    base: '',
    platforms: { bun: { runtime: 'bun', unmarked: true } },
    shipped: 'bun',
    allows: {},
    refuses: { bun: ['node:fs'] },
    packages: {},
    apps: [],
    programs: [{ at: 'packages/web/tool.ts', platform: 'bun' }],
    compiled: [],
    leaves: [],
    files: { extensions: ['.ts'], exclude: [] },
  },
};
const revision = Effect.fnUntraced(function* (fx: EnforcementFixture, spec: string) {
  return (yield* spawnedEffect(['git', 'rev-parse', spec], { cwd: fx.demo.demoRoot })).stdout.toString().trim();
});
const landing = (fx: EnforcementFixture, path: string) =>
  fx.working(
    Effect.gen(function* () {
      const checks = yield* checksIn;
      return yield* checks.before('submit_work', {
        kind: 'tree',
        projectId: fx.demo.projectId,
        root: fx.demo.demoRoot,
        base: yield* revision(fx, 'HEAD~1'),
        built: yield* revision(fx, 'HEAD^{tree}'),
        paths: [path],
        caller: { _tag: 'Thread', threadId: ThreadId.make('thread-1'), projectId: fx.demo.projectId },
      });
    }),
  );
layer(enforceFixture(), { excludeTestServices: true })('enforcement', (it) => {
  describe('a tsconfig extending the config of a package the checkout installed', () => {
    it.effect(
      'is measured and landed through the installed package, its link followed out of the checkout as TypeScript follows it, and refuses once the package is gone',
      () =>
        withEnforcement((fx) =>
          Effect.fnUntraced(function* () {
            const files = yield* FileSystem.FileSystem;
            const store = `../acme-store-${fx.demo.projectId}/node_modules/@acme`;
            yield* fx.wrote('.gitignore', 'node_modules/\n');
            yield* fx.wrote('tsconfig.json', JSON.stringify({ extends: '@acme/tsconfig/base.json' }));
            yield* fx.wrote(`${store}/tsconfig/package.json`, JSON.stringify({ name: '@acme/tsconfig', version: '1.0.0' }));
            yield* fx.wrote(`${store}/tsconfig/base.json`, JSON.stringify({ extends: '@acme/strict/strict.json' }));
            yield* fx.wrote(`${store}/strict/package.json`, JSON.stringify({ name: '@acme/strict', version: '1.0.0' }));
            yield* fx.wrote(
              `${store}/strict/strict.json`,
              JSON.stringify({ compilerOptions: { paths: { '$x/*': ['${configDir}/src/app/*'] } } }),
            );
            yield* files.makeDirectory(join(fx.demo.demoRoot, 'node_modules/@acme'), { recursive: true });
            yield* files.symlink(join(fx.demo.demoRoot, store, 'tsconfig'), join(fx.demo.demoRoot, 'node_modules/@acme/tsconfig'));
            yield* fx.wrote('src/app/shared.ts', 'export const shared = 1;\n');
            yield* fx.wrote('src/core/peek.ts', "import { shared } from '$x/shared';\nexport const peek = shared;\n");
            yield* fx.committed('a config extending an installed package');
            const rule = yield* fx.created(['rule'], 'Import only downward');
            const owner = yield* fx.created(['task'], 'Move the core off the app');
            fx.demo.described.set('installed', ROOTED);
            const standing = ['app order src/core/peek.ts -> src/app/', 'app order src/core/view.ts -> src/ui/'];
            yield* fx.enforce({
              blockId: rule,
              strictness: 'gate',
              on: TRIGGERS.landing,
              inspection: 'installed',
              owners: Object.fromEntries(standing.map((one) => [one, owner])),
            });
            expect((yield* fx.documentOf(rule))?.debt?.map(({ fingerprint }) => fingerprint).sort()).toEqual(standing);
            yield* fx.wrote('src/core/peek.ts', "import { shared } from '$x/shared';\nexport const peek = shared + 1;\n");
            yield* fx.committed('the peek adds one');
            expect((yield* landing(fx, 'src/core/peek.ts')).refused).toBeNull();
            yield* files.remove(join(fx.demo.demoRoot, 'node_modules'), { recursive: true });
            const uninstalled = yield* landing(fx, 'src/core/peek.ts');
            expect(uninstalled.refused?.code).toBe('inspection-failed');
            expect(uninstalled.refused?.reason).toContain('`@acme/tsconfig/base.json`');
          })(),
        ),
    );

    it.effect('is measured and landed through a package whose link leads into a git submodule of the checkout', () =>
      withEnforcement((fx) =>
        Effect.fnUntraced(function* () {
          const files = yield* FileSystem.FileSystem;
          const shared = `../acme-shared-${fx.demo.projectId}`;
          yield* fx.wrote(`${shared}/tsconfig/package.json`, JSON.stringify({ name: '@acme/tsconfig', version: '1.0.0' }));
          yield* fx.wrote(`${shared}/tsconfig/base.json`, JSON.stringify({ extends: './strict.json' }));
          yield* fx.wrote(
            `${shared}/tsconfig/strict.json`,
            JSON.stringify({ compilerOptions: { paths: { '$x/*': ['${configDir}/src/app/*'] } } }),
          );
          const source = join(fx.demo.demoRoot, shared);
          yield* gitEffect(source, ['init', '-q']);
          yield* gitEffect(source, ['add', '-A']);
          yield* gitEffect(source, ['commit', '-qm', 'shared configs']);
          yield* gitEffect(fx.demo.demoRoot, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, 'vendor/shared']);
          yield* fx.wrote('.gitignore', 'node_modules/\n');
          yield* fx.wrote('tsconfig.json', JSON.stringify({ extends: '@acme/tsconfig/base.json' }));
          yield* files.makeDirectory(join(fx.demo.demoRoot, 'node_modules/@acme'), { recursive: true });
          yield* files.symlink('../../vendor/shared/tsconfig', join(fx.demo.demoRoot, 'node_modules/@acme/tsconfig'));
          yield* fx.wrote('src/app/shared.ts', 'export const shared = 1;\n');
          yield* fx.wrote('src/core/peek.ts', "import { shared } from '$x/shared';\nexport const peek = shared;\n");
          yield* fx.committed('a config extending a package of a submodule');
          const rule = yield* fx.created(['rule'], 'Import only downward');
          const owner = yield* fx.created(['task'], 'Move the core off the app');
          fx.demo.described.set('submodule', ROOTED);
          const standing = ['app order src/core/peek.ts -> src/app/', 'app order src/core/view.ts -> src/ui/'];
          yield* fx.enforce({
            blockId: rule,
            strictness: 'gate',
            on: TRIGGERS.landing,
            inspection: 'submodule',
            owners: Object.fromEntries(standing.map((one) => [one, owner])),
          });
          expect((yield* fx.documentOf(rule))?.debt?.map(({ fingerprint }) => fingerprint).sort()).toEqual(standing);
          yield* fx.wrote('src/core/peek.ts', "import { shared } from '$x/shared';\nexport const peek = shared + 1;\n");
          yield* fx.committed('the peek adds one');
          expect((yield* landing(fx, 'src/core/peek.ts')).refused).toBeNull();
        })(),
      ),
    );

    it.effect(
      'leaves an alias aiming into an installed package outside the judged code, and lands one aiming into a workspace member through its link on the member',
      () =>
        withEnforcement((fx) =>
          Effect.fnUntraced(function* () {
            const files = yield* FileSystem.FileSystem;
            const kit = `../acme-kit-${fx.demo.projectId}`;
            yield* fx.wrote('.gitignore', 'node_modules/\n');
            yield* fx.wrote('package.json', JSON.stringify({ name: 'demo', private: true, workspaces: ['src/ui'] }));
            yield* fx.wrote('src/ui/package.json', JSON.stringify({ name: '@acme/ui', version: '1.0.0' }));
            yield* fx.wrote(
              'tsconfig.json',
              JSON.stringify({
                compilerOptions: { paths: { '$kit/*': ['./node_modules/@acme/kit/*'], '$ui/*': ['./node_modules/@acme/ui/*'] } },
              }),
            );
            yield* fx.wrote(`${kit}/package.json`, JSON.stringify({ name: '@acme/kit', version: '1.0.0' }));
            yield* fx.wrote(`${kit}/tool.ts`, 'export const tool = 1;\n');
            yield* files.makeDirectory(join(fx.demo.demoRoot, 'node_modules/@acme'), { recursive: true });
            yield* files.symlink(join(fx.demo.demoRoot, kit), join(fx.demo.demoRoot, 'node_modules/@acme/kit'));
            yield* files.symlink('../../src/ui', join(fx.demo.demoRoot, 'node_modules/@acme/ui'));
            yield* fx.wrote(
              'src/core/peek.ts',
              "import { tool } from '$kit/tool';\nimport { panel } from '$ui/panel';\nexport const peek = tool + panel;\n",
            );
            yield* fx.committed('aliases into installed packages');
            const rule = yield* fx.created(['rule'], 'Import only downward');
            const owner = yield* fx.created(['task'], 'Move the core off the ui');
            fx.demo.described.set('aliases', ROOTED);
            yield* fx.enforce({ blockId: rule, strictness: 'gate', on: TRIGGERS.landing, inspection: 'aliases', absorb: 'all', owner });
            expect((yield* fx.documentOf(rule))?.debt?.map(({ fingerprint }) => fingerprint).sort()).toEqual([
              'app order src/core/peek.ts -> src/ui/',
              'app order src/core/view.ts -> src/ui/',
            ]);
          })(),
        ),
    );

    it.effect(
      'resolves the loads of every start through the installed package, and a start reaching it refuses once the package is gone',
      () =>
        withEnforcement((fx) =>
          Effect.fnUntraced(function* () {
            const files = yield* FileSystem.FileSystem;
            const store = `../acme-store-${fx.demo.projectId}/node_modules/@acme`;
            yield* fx.wrote('.gitignore', 'node_modules/\n');
            yield* fx.wrote('package.json', JSON.stringify({ name: 'demo', private: true, workspaces: ['packages/*'] }));
            yield* fx.wrote('tsconfig.json', JSON.stringify({ extends: '@acme/tsconfig/base.json' }));
            yield* fx.wrote(`${store}/tsconfig/package.json`, JSON.stringify({ name: '@acme/tsconfig', version: '1.0.0' }));
            yield* fx.wrote(`${store}/tsconfig/base.json`, JSON.stringify({ extends: '@acme/strict/strict.json' }));
            yield* fx.wrote(`${store}/strict/package.json`, JSON.stringify({ name: '@acme/strict', version: '1.0.0' }));
            yield* fx.wrote(
              `${store}/strict/strict.json`,
              JSON.stringify({
                compilerOptions: {
                  paths: { '$x/*': ['${configDir}/packages/web/lib/*'], '$kit/*': ['${configDir}/node_modules/@acme/kit/*'] },
                },
              }),
            );
            yield* fx.wrote(`${store}/kit/tool.ts`, 'export const kit = 1;\n');
            yield* files.makeDirectory(join(fx.demo.demoRoot, 'node_modules/@acme'), { recursive: true });
            yield* files.symlink(join(fx.demo.demoRoot, store, 'tsconfig'), join(fx.demo.demoRoot, 'node_modules/@acme/tsconfig'));
            yield* files.symlink(join(fx.demo.demoRoot, store, 'kit'), join(fx.demo.demoRoot, 'node_modules/@acme/kit'));
            yield* fx.wrote('packages/web/package.json', JSON.stringify({ name: 'web', exports: { '.': { bun: './main.ts' } } }));
            yield* fx.wrote(
              'packages/web/main.ts',
              "import { shared } from '$x/shared';\nimport { kit } from '$kit/tool';\nexport const main = shared + kit;\n",
            );
            yield* fx.wrote('packages/web/tool.ts', 'export const tool = 1;\n');
            yield* fx.wrote('packages/web/lib/shared.ts', 'export const shared = 1;\n');
            yield* fx.committed('a web package whose alias an installed config declares');
            const rule = yield* fx.created(['rule'], 'Load only what bun runs');
            fx.demo.described.set('loading', LOADING);
            const enforced = yield* fx.enforce({ blockId: rule, strictness: 'gate', on: TRIGGERS.landing, inspection: 'loading' });
            expect(enforced).toMatchObject({ debt: { after: 0 }, escaped: 0 });
            yield* fx.wrote('packages/web/tool.ts', "import './main';\nexport const tool = 1;\n");
            yield* fx.committed('the tool runs the main');
            expect((yield* landing(fx, 'packages/web/tool.ts')).refused).toBeNull();
            yield* files.remove(join(fx.demo.demoRoot, 'node_modules'), { recursive: true });
            const uninstalled = yield* landing(fx, 'packages/web/tool.ts');
            expect(
              uninstalled.crossed?.map(({ fingerprint, message }) => [fingerprint, message.includes('`@acme/tsconfig/base.json`')]),
            ).toEqual([['packages/web/tool.ts [bun] -> unresolved packages/web/main.ts @ packages/web/main.ts', true]]);
          })(),
        ),
    );
  });
});
