import { layer } from '@runlith/effect-test';
import { describe, expect } from 'bun:test';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { Effect } from 'effect';
import type { Inspection, Params } from '@tagma/inspection/builtins';
import { TRIGGERS } from '../../../graph/testing/triggers.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { perform } from '../../../invocation/testing/performing.js';
import { checksIn } from '../../../enforcement/testing/wiring.js';
import { LAYERED } from '../../../enforcement/testing/layered.js';
import { bodies, enforceFixture, operator, withEnforcement, type EnforcementFixture } from './enforceFixture.js';
const ROOTED: Params<'modules'> = { ...(LAYERED.params as Params<'modules'>), base: '' };
const BARE: Inspection = { builtin: 'modules', params: ROOTED };
const COPIED: Inspection = {
  builtin: 'modules',
  params: {
    ...ROOTED,
    built: [{ output: '.gen/tsconfig.json', source: 'gen.json', why: 'The committed copy of the config the build generates.' }],
  },
};
const aliases = (shared: string) => JSON.stringify({ compilerOptions: { paths: { '$ui/*': ['../src/ui/*'], '$x/*': [shared] } } });
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
  describe('a tsconfig extending a file the build generates and git ignores', () => {
    it.effect(
      'is measured and redrawn through a built copy, refuses enforcement without one and leaves a stale copy unjudged at landing',
      () =>
        withEnforcement((fx) =>
          Effect.fnUntraced(function* () {
            yield* fx.wrote('.gitignore', '.gen/\n');
            yield* fx.wrote('tsconfig.json', JSON.stringify({ extends: './.gen/tsconfig.json' }));
            yield* fx.wrote('gen.json', aliases('../src/core/*'));
            yield* fx.wrote('src/core/shared.ts', 'export const shared = 1;\n');
            yield* fx.wrote('src/app/shared.ts', 'export const shared = 2;\n');
            yield* fx.wrote(
              'src/core/peek.ts',
              "import { panel } from '$ui/panel';\nimport { shared } from '$x/shared';\nexport const peek = panel + shared;\n",
            );
            yield* fx.committed('a config extending a generated one');
            const rule = yield* fx.created(['rule'], 'Import only downward');
            const owner = yield* fx.created(['task'], 'Move the core off the panel');
            fx.demo.described.set('bare', BARE);
            fx.demo.described.set('copied', COPIED);
            const unread = yield* fx.refused({ blockId: rule, strictness: 'gate', on: TRIGGERS.landing, inspection: 'bare' });
            expect(unread.code).toBe('inspection-failed');
            expect(unread.reason).toContain('.gen/tsconfig.json');
            const standing = ['app order src/core/peek.ts -> src/ui/', 'app order src/core/view.ts -> src/ui/'];
            yield* fx.enforce({
              blockId: rule,
              strictness: 'gate',
              on: TRIGGERS.landing,
              inspection: 'copied',
              owners: Object.fromEntries(standing.map((one) => [one, owner])),
            });
            expect((yield* fx.documentOf(rule))?.debt?.map(({ fingerprint }) => fingerprint).sort()).toEqual(standing);
            const opened = 'app order src/ui/panel.ts -> src/core/';
            const flipped = yield* fx.working(
              perform(
                bodies.set_module,
                { modules: [{ id: 'app', order: [['ui/'], ['core/'], ['app/']] }], absorb: [opened], owners: { [opened]: owner } },
                operator,
              ),
            );
            expect([...(flipped.rules.find((one) => one.rule === rule)?.retired ?? [])].sort()).toEqual(standing);
            yield* fx.wrote('gen.json', aliases('../src/app/*'));
            yield* fx.committed('the copy aims the shared alias at the app');
            const judged = yield* landing(fx, 'gen.json');
            expect(judged.refused?.code).toBe('rule-violated');
            expect(judged.refused?.reason).toContain('src/core/peek.ts:2 imports `$x/shared`');
            expect(judged.refused?.unblock.join('\n')).toContain('"app order src/core/peek.ts -> src/app/"');
            yield* fx.wrote('.gen/tsconfig.json', aliases('../src/core/*'));
            yield* fx.wrote(
              'src/core/peek.ts',
              "import { panel } from '$ui/panel';\nimport { shared } from '$x/shared';\nexport const peek = panel * shared;\n",
            );
            yield* fx.committed('the peek multiplies');
            const stale = yield* landing(fx, 'src/core/peek.ts');
            expect(stale.refused).toBeNull();
            expect(stale.unjudged).toEqual([expect.objectContaining({ failed: expect.stringContaining('`gen.json`') })]);
            expect(stale.unjudged).toEqual([expect.objectContaining({ failed: expect.stringContaining('`.gen/tsconfig.json`') })]);
            yield* fx.wrote('gen.json', JSON.stringify(JSON.parse(aliases('../src/core/*')), null, '\t'));
            yield* fx.committed('the copy follows the generated config');
            expect((yield* landing(fx, 'gen.json')).refused).toBeNull();
          })(),
        ),
    );
  });
});
