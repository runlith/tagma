import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { ProgramInvocation, RunnerDescriptor } from '@tagma/inspection/program';
import { Effect, FileSystem } from 'effect';
import type { ProgramLaunch } from '../../executions/contract/service/programs.js';
import { ProgramRoad } from '../../executions/contract/service/programs.js';
import type { Checker } from './checker.js';
import { Inspections, inspections } from '../workers/inspectionLanes.js';
import { localRoad } from '../../executions/testing/road.js';
import { committed, testGit } from './fixture.js';
import { judgePrograms, type ProgramBinding } from './group.js';

const descriptor: RunnerDescriptor = { id: 'python-law', adapter: 'ast-grep', config: 'checks/sgconfig.yml', layout: 'files' };

const installed = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const require = createRequire(import.meta.url);
  const cli = require.resolve('@ast-grep/cli/package.json', { paths: [join(import.meta.dirname, '../../../../inspection')] });
  const suffix = process.platform === 'linux' ? '-gnu' : process.platform === 'win32' ? '-msvc' : '';
  const name = `@ast-grep/cli-${process.platform}-${process.arch}${suffix}`;
  const native = require.resolve(`${name}/package.json`, { paths: [dirname(cli)] });
  const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'ast-grep-group-' }));
  mkdirSync(join(home, 'node_modules/@ast-grep/cli'), { recursive: true });
  writeFileSync(join(home, 'node_modules/@ast-grep/cli/package.json'), readFileSync(cli));
  cpSync(dirname(native), join(home, 'node_modules', name), { recursive: true });
  mkdirSync(join(home, 'checks/rules'), { recursive: true });
  writeFileSync(join(home, 'checks/sgconfig.yml'), 'ruleDirs: [rules]');
  writeFileSync(
    join(home, 'checks/rules/.domain.yml'),
    'id: domain-imports\nlanguage: Python\nseverity: error\nrule: {pattern: import billing.api}',
  );
  const checker: Checker = { id: descriptor.id, descriptor, launch: [process.execPath, '--no-install'], cwd: home };
  return { home, head: committed(home, ['checks']), checker, native: name };
});

layer(BunFileSystem.layer, { excludeTestServices: true })('ast-grep program', (it) => {
  it.effect('ten governed Python rules share one real ast-grep process over both sides, with one new count crossing each', () =>
    Effect.gen(function* () {
      const { home, head, checker, native } = yield* installed;
      const lanes = yield* Effect.acquireRelease(
        Effect.sync(() => inspections()),
        (opened) => Effect.sync(() => opened.close()),
      );
      const launches: ProgramLaunch[] = [];
      const binding: ProgramBinding = {
        rule: 'rule',
        check: { key: 'domain-imports', program: { linter: { tool: 'ast-grep', config: 'checks/sgconfig.yml' }, rule: 'domain-imports' } },
        places: ['src'],
        debt: [],
        checker,
      };
      const sides: ProgramInvocation['sides'] = [
        { side: 'tree', paths: ['src/domain.py'], files: [{ path: 'src/domain.py', text: 'import billing.api\nimport billing.api\n' }] },
        { side: 'base', paths: ['src/domain.py'], files: [{ path: 'src/domain.py', text: 'import billing.core\n' }] },
      ];
      const bindings = Array.from({ length: 10 }, (_, at) => ({ ...binding, rule: `rule-${at}` }));
      const answers = yield* judgePrograms(
        { projectId: 1, root: home, tree: head, base: 'base', sides, caller: { _tag: 'Operator' } },
        bindings,
      ).pipe(
        Effect.provideService(ProgramRoad, localRoad(launches)),
        Effect.provideService(Inspections, Inspections.of(lanes)),
        Effect.provide(testGit),
      );
      const answer = yield* Effect.fromResult(answers.get(checker.id)!.answer);
      expect(launches.length).toBe(1);
      expect(answer.length).toBe(10);
      expect(answer.map((one) => one.verdict.violations.map((violation) => [violation.file, violation.value]))).toEqual(
        Array.from({ length: 10 }, () => [['src/domain.py', 2]]),
      );
      expect(launches[0]!.argv[0]).toBe(join(home, 'node_modules', native, process.platform === 'win32' ? 'ast-grep.exe' : 'ast-grep'));
    }),
  );
});
