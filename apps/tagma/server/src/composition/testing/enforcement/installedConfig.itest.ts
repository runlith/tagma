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
import { enforceFixture, withEnforcement, type EnforcementFixture } from './enforceFixture.js';

const ROOTED: Inspection = { builtin: 'modules', params: { ...(LAYERED.params as Params<'modules'>), base: '' } };
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
  });
});
