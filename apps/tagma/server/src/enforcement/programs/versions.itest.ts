import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Effect, FileSystem, Result } from 'effect';
import { ProgramRoad } from '../../executions/contract/service/programs.js';
import { localRoad } from '../../executions/testing/road.js';
import { Inspections, inspections } from '../workers/inspectionLanes.js';
import { checkerFor } from './checker.js';
import { committed, testGit } from './fixture.js';
import { judgePrograms, type ProgramBinding } from './group.js';

layer(BunFileSystem.layer, { excludeTestServices: true })('linter version requirements', (it) => {
  it.effect('unsupported installations name the needed and found versions when their API or output format cannot be used', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'linter-versions-' }));
      const put = Effect.fnUntraced(function* (path: string, text: string) {
        const absolute = join(home, path);
        yield* files.makeDirectory(join(absolute, '..'), { recursive: true });
        yield* files.writeFileString(absolute, text);
      });
      yield* put('node_modules/oxlint/package.json', '{"version":"1.62.0"}');
      yield* put('node_modules/@ast-grep/cli/package.json', '{"version":"0.41.0"}');
      yield* put('node_modules/eslint/package.json', '{"name":"eslint","version":"8.57.0","main":"index.js"}');
      yield* put('node_modules/eslint/index.js', 'throw new Error("this API is too old to load");');
      yield* put(
        'semgrep.js',
        'if (process.argv.includes("--version")) console.log("1.55.2"); else throw new Error("this CLI cannot scan");',
      );
      yield* put(
        'semgrep.yml',
        'rules:\n - id: imports\n   languages: [python]\n   severity: ERROR\n   message: forbidden import\n   pattern: import billing.api\n',
      );
      const checks: ProgramBinding['check'][] = [
        { key: 'oxlint', program: { linter: { tool: 'oxlint' }, rule: 'eslint/no-console' } },
        { key: 'ast-grep', program: { linter: { tool: 'ast-grep', config: 'sgconfig.yml' }, rule: 'imports' } },
        { key: 'eslint', program: { linter: { tool: 'eslint' }, rule: 'no-console' } },
        {
          key: 'semgrep',
          program: {
            linter: { tool: 'semgrep', config: 'semgrep.yml', argv: ['bun', '--no-install', join(home, 'semgrep.js')] },
            rule: 'imports',
          },
        },
      ];
      const bindings = checks.map((check): ProgramBinding => ({
        rule: check.key,
        check,
        places: [check.key === 'oxlint' || check.key === 'eslint' ? 'src/a.js' : 'src/a.py'],
        debt: [],
        checker: checkerFor(home, check),
      }));
      const lanes = yield* Effect.acquireRelease(
        Effect.sync(() => inspections()),
        (value) => Effect.sync(() => value.close()),
      );
      const answers = yield* judgePrograms(
        {
          projectId: 1,
          root: home,
          tree: committed(home, ['semgrep.js', 'semgrep.yml']),
          base: null,
          caller: { _tag: 'Operator' },
          sides: [
            {
              side: 'tree',
              paths: ['src/a.js', 'src/a.py'],
              files: [
                { path: 'src/a.js', text: 'console.log(1);' },
                { path: 'src/a.py', text: 'import billing.api' },
              ],
            },
          ],
        },
        bindings,
      ).pipe(
        Effect.provideService(ProgramRoad, localRoad([])),
        Effect.provideService(Inspections, Inspections.of(lanes)),
        Effect.provide(testGit),
      );
      const expected = [
        ['1.63.0', '1.62.0'],
        ['0.41.1', '0.41.0'],
        ['9.0.0', '8.57.0'],
        ['1.56.0', '1.55.2'],
      ];
      for (const [index, binding] of bindings.entries()) {
        const answer = answers.get(binding.checker!.id)!.answer;
        if (Result.isSuccess(answer)) return yield* Effect.die(`${binding.rule} accepted an unsupported installation`);
        expect(answer.failure.reason).toContain(expected[index]![0]!);
        expect(answer.failure.reason).toContain(expected[index]![1]!);
      }
    }),
  );
});
