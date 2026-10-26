import { expect } from 'bun:test';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem } from 'effect';
import { TRIGGERS } from '../../../graph/testing/triggers.js';
import { ProgramRoad } from '../../../executions/contract/service/programs.js';
import { localRoad } from '../../../executions/testing/road.js';
import { headChecked, targetsOf } from '../../../enforcement/testing/wiring.js';
import { enforceFixture, withEnforcement } from './enforceFixture.js';

layer(enforceFixture(), { excludeTestServices: true })('file checker judgement', (it) => {
  it.effect('whole-reach judgement reads the committed files through a file checker and names an unreadable mandatory config', () =>
    withEnforcement((fx) =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const root = fx.demo.demoRoot;
        const road = localRoad([]);
        yield* files.makeDirectory(join(root, 'node_modules'), { recursive: true });
        yield* files.symlink(dirname(createRequire(import.meta.url).resolve('oxlint/package.json')), join(root, 'node_modules/oxlint'));
        yield* fx.wrote('.gitignore', 'node_modules/\n');
        yield* fx.wrote(
          'tools/law.json',
          JSON.stringify({ plugins: [], categories: { correctness: 'off' }, rules: { 'eslint/no-console': 'error' } }),
        );
        yield* fx.committed('configure the file checker');
        fx.demo.described.set('no-console', {
          linter: { tool: 'oxlint', config: 'tools/law.json' },
          rule: 'eslint/no-console',
          files: ['src/**/*.ts'],
        });
        const rule = yield* fx.created(['rule'], 'No console calls');
        yield* fx
          .enforce({ blockId: rule, strictness: 'gate', on: TRIGGERS.landing, inspection: 'no-console' })
          .pipe(Effect.provideService(ProgramRoad, road));
        yield* fx.wrote('src/core/model.ts', 'console.log(1);\nconsole.log(2);\n');
        yield* fx.committed('introduce two governed calls');
        yield* fx.wrote('src/core/model.ts', 'export const cleanWorkingFile = true;\n');
        const check = (tree: string) =>
          fx
            .working(
              Effect.gen(function* () {
                const caller = { _tag: 'Operator' as const };
                const ask = { projectId: fx.demo.projectId, rules: [rule], caller };
                const targets = yield* targetsOf(ask, { projectId: fx.demo.projectId, actor: caller, root, tree });
                return yield* headChecked(ask, targets, { root, head: tree });
              }),
            )
            .pipe(Effect.provideService(ProgramRoad, road));
        const checked = yield* check(yield* fx.head());
        expect(checked.violations.map(({ file, value }) => [file, value])).toEqual([['src/core/model.ts', 2]]);
        yield* files.remove(join(root, 'tools/law.json'));
        yield* fx.committed('drop the config');
        const unread = yield* check(yield* fx.head());
        expect(unread.rules[0]?.failed).toContain('tools/law.json is not in the judged tree');
      }),
    ),
  );
});
