import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, FileSystem, Result } from 'effect';
import { checkerFor } from './checker.js';
import { committed } from './fixture.js';
import type { ProgramInvocation } from '@tagma/inspection/program';
import { ProgramRoad, type ProgramLaunch } from '../../executions/contract/service/programs.js';
import type { Checker } from './checker.js';
import { localRoad } from '../../executions/testing/road.js';
import { judgePrograms, type GroupSubject, type ProgramBinding } from './group.js';

const source = `const input = JSON.parse(await Bun.stdin.text());
console.log(JSON.stringify({
  request: input.request, checker: input.checker, tree: input.tree, base: input.base,
  run: { tool: 'fixture', version: '1', capabilities: {} },
  readings: input.keys.flatMap(key => input.sides.map(side => ({
    key: key.key, side: side.side, covered: { scope: 'reach' }, unjudged: [],
    findings: Array.from({ length: side.side === 'tree' ? key.params.count : 2 }, (_, n) => ({
      fingerprint: 'same', path: key.reach.places[0] + '/a.ts', line: n + 1, message: 'violation'
    }))
  })))
}));`;

const subject = (root: string): GroupSubject => ({
  projectId: 1,
  root,
  tree: 'built',
  base: 'base',
  caller: { _tag: 'Operator' },
  sides: [
    {
      side: 'tree',
      paths: ['src/a.ts', 'lib/a.ts'],
      files: [
        { path: 'src/a.ts', text: 'built' },
        { path: 'lib/a.ts', text: 'built' },
      ],
    },
    {
      side: 'base',
      paths: ['src/a.ts', 'lib/a.ts'],
      files: [
        { path: 'src/a.ts', text: 'base' },
        { path: 'lib/a.ts', text: 'base' },
      ],
    },
  ],
});

layer(BunFileSystem.layer, { excludeTestServices: true })('program groups', (it) => {
  it.effect('an explicit frontier covers an unchanged file on both sides and defeats stale debt only for its confirmed base', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'checker-frontier-' });
      yield* files.makeDirectory(join(root, 'src'));
      yield* files.writeFileString(
        join(root, 'check.ts'),
        `import { defineProgram } from '@runlith/tagma/rules';
const read = async side => ({
  covered: [...side.paths, 'src/b.ts'],
  findings: Number(await side.read('src/a.ts')) === 0 ? [] : [
    { fingerprint: 'marker', path: 'src/b.ts', message: await side.read('src/b.ts') }
  ]
});
export default defineProgram({ audit: async ({ tree, base }) => ({ tree: await read(tree), base: await read(base) }) });`,
      );
      yield* files.writeFileString(join(root, 'src/a.ts'), '0');
      yield* files.writeFileString(join(root, 'src/b.ts'), 'affected');
      const base = committed(root);
      yield* files.writeFileString(join(root, 'src/a.ts'), '1');
      const tree = committed(root, ['src/a.ts']);
      const check = { key: 'audit', program: { program: 'check.ts', name: 'audit', concern: 'code' as const, needs: [], params: {} } };
      const checker = checkerFor(root, check);
      const binding: ProgramBinding = {
        rule: 'audit',
        check,
        places: ['src'],
        checker,
        debt: [{ fingerprint: 'audit marker', owner: 'task', count: 1 }],
      };
      const result = (yield* judgePrograms(
        {
          ...subject(root),
          tree,
          base,
          sides: [
            { side: 'tree', paths: ['src/a.ts'], files: [{ path: 'src/a.ts', text: '1' }] },
            { side: 'base', paths: ['src/a.ts'], files: [{ path: 'src/a.ts', text: '0' }] },
          ],
        },
        [binding],
      ).pipe(Effect.provideService(ProgramRoad, localRoad([])))).get(checker.id)!.answer;
      if (Result.isFailure(result)) return yield* Effect.die(new Error(result.failure.reason));
      const answer = result.success;
      expect(answer[0]!.verdict.violations.map((one) => one.file)).toEqual(['src/b.ts']);
      expect(answer[0]!.coverage.paths).toEqual(['src/a.ts', 'src/b.ts']);
    }),
  );

  it.effect('unprepared keys are prepared by one whole reading of the tree and the group is then judged, the prepared key untouched', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'checker-prepare-' });
      yield* files.writeFileString(
        join(root, 'check.ts'),
        `import { defineProgram } from '@runlith/tagma/rules';
import { existsSync, writeFileSync } from 'node:fs';
class NeedsPreparation extends Error { name = 'NeedsPreparation'; }
const indexed = (what) => ({ tree, mode }) => {
  const marker = ${JSON.stringify(root)} + '/' + what + '.index';
  if (mode === 'measure') writeFileSync(marker, 'whole');
  else if (!existsSync(marker)) throw new NeedsPreparation(what + ' holds no index');
  return { tree: { findings: [{ fingerprint: what, path: tree.paths[0] ?? 'src/a.ts', message: what }] } };
};
export default defineProgram({
  first: indexed('first'),
  second: ({ tree }) => ({ tree: { findings: [{ fingerprint: 'second', path: tree.paths[0], message: 'ready' }] } }),
  third: indexed('third'),
});`,
      );
      const head = committed(root, ['check.ts']);
      const checks = ['first', 'second', 'third'].map((name) => ({
        key: name,
        program: { program: 'check.ts', name, concern: 'code' as const, needs: [], params: {} },
      }));
      const checker = checkerFor(root, checks[0]!);
      const bindings: ProgramBinding[] = checks.map((check) => ({ rule: check.key, check, places: ['src'], debt: [], checker }));
      const judged: GroupSubject = { ...subject(root), tree: head, base: null, sides: [subject(root).sides[0]] };
      const launches: ProgramLaunch[] = [];
      const answered = (yield* judgePrograms(judged, bindings).pipe(Effect.provideService(ProgramRoad, localRoad(launches)))).get(
        checker.id,
      )!.answer;
      const answer = yield* Effect.fromResult(answered);
      expect(answer.map((one) => [one.rule, one.verdict.violations.length]).sort()).toEqual([
        ['first', 1],
        ['second', 1],
        ['third', 1],
      ]);
      const invocations = launches.map((one) => JSON.parse(one.stdin) as ProgramInvocation);
      expect(invocations.map((one) => one.mode)).toEqual([undefined, 'measure', undefined]);
      expect(invocations[1]!.keys.map((key) => key.id)).toEqual(['first', 'third']);
      expect(invocations[1]!.sides).toEqual([{ side: 'tree', paths: null, files: null }]);

      const again = yield* judgePrograms(judged, bindings).pipe(Effect.provideService(ProgramRoad, localRoad(launches)));
      yield* Effect.fromResult(again.get(checker.id)!.answer);
      expect(launches.slice(3).map((one) => (JSON.parse(one.stdin) as ProgramInvocation).mode)).toEqual([undefined]);
    }),
  );

  it.effect('a thrown key beside unprepared ones preserves the healthy reading and names each failed rule separately', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'checker-unprepared-' });
      yield* files.writeFileString(
        join(root, 'check.ts'),
        `import { defineProgram } from '@runlith/tagma/rules';
class NeedsPreparation extends Error { name = 'NeedsPreparation'; }
const needs = (what) => () => { throw new NeedsPreparation(what + ' holds no index'); };
export default defineProgram({
  first: needs('first'),
  second: ({ tree }) => ({ tree: { findings: [{ fingerprint: 'm', path: tree.paths[0], message: 'ok' }] } }),
  third: needs('third'),
  fourth: () => { throw new Error('boom'); },
});`,
      );
      const head = committed(root, ['check.ts']);
      const checks = ['first', 'second', 'third', 'fourth'].map((name) => ({
        key: name,
        program: { program: 'check.ts', name, concern: 'code' as const, needs: [], params: {} },
      }));
      const checker = checkerFor(root, checks[0]!);
      const bindings: ProgramBinding[] = checks.map((check) => ({ rule: check.key, check, places: ['src'], debt: [], checker }));
      const judged: GroupSubject = { ...subject(root), tree: head, base: null, sides: [subject(root).sides[0]] };
      const run = (yield* judgePrograms(judged, bindings).pipe(Effect.provideService(ProgramRoad, localRoad([])))).get(checker.id)!;
      const readings = yield* Effect.fromResult(run.answer);
      expect(readings.map((one) => [one.rule, one.verdict.violations.length])).toEqual([['second', 1]]);
      expect([...run.failures.keys()].sort()).toEqual(['first', 'fourth', 'third']);
      expect(run.failures.get('first')?.reason).toContain('first is unprepared: first holds no index');
      expect(run.failures.get('third')?.reason).toContain('third is unprepared: third holds no index');
      expect(run.failures.get('fourth')?.reason).toContain('fourth threw: Error: boom');
    }),
  );

  it.effect('a missing checkout dependency names its environment, and preparing that checkout makes the same inspection judge', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'checker-environment-' });
      yield* files.writeFileString(
        join(root, 'check.ts'),
        `import { message } from 'project-check';
export default { audit: ({ tree }) => ({ tree: { findings: [{ fingerprint: 'marker', path: tree.paths[0], message }] } }) };`,
      );
      const head = committed(root, ['check.ts']);
      const check = { key: 'audit', program: { program: 'check.ts', name: 'audit', concern: 'code' as const, needs: [], params: {} } };
      const checker = checkerFor(root, check);
      const bindings: ProgramBinding[] = [{ rule: 'audit', check, places: ['src'], debt: [], checker }];
      const judged: GroupSubject = { ...subject(root), tree: head, base: null, sides: [subject(root).sides[0]] };
      const inspect = judgePrograms(judged, bindings).pipe(Effect.provideService(ProgramRoad, localRoad([])));
      const failed = (yield* inspect).get(checker.id)!.answer;
      if (Result.isSuccess(failed)) return yield* Effect.die('the unprepared checkout was judged');
      expect(failed.failure.cause).toBe('program');
      expect(failed.failure.reason).toContain('project-check');
      expect(failed.failure.ways).toEqual(expect.arrayContaining([expect.stringContaining(root)]));

      const dependency = join(root, 'node_modules/project-check');
      yield* files.makeDirectory(dependency, { recursive: true });
      yield* files.writeFileString(join(dependency, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }));
      yield* files.writeFileString(join(dependency, 'index.js'), "export const message = 'prepared checkout';");
      const answer = yield* Effect.fromResult((yield* inspect).get(checker.id)!.answer);
      expect(answer[0]!.verdict.violations.map((one) => [one.file, one.message])).toEqual([['src/a.ts', 'prepared checkout']]);
    }),
  );

  it.effect(
    'ten rules share one immutable checker process, identical keys share readings and different parameters and reaches remain independent',
    () =>
      Effect.gen(function* () {
        const root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'contract-two-' });
        const path = join(root, 'checker.js');
        writeFileSync(path, source);
        const checker: Checker = {
          id: 'fixture',
          descriptor: { id: 'fixture', adapter: 'program', argv: [process.execPath, path], layout: 'program' },
          launch: [process.execPath, path],
          cwd: root,
        };
        const bindings: ProgramBinding[] = Array.from({ length: 10 }, (_, at) => ({
          rule: `rule-${at}`,
          check: {
            key: at < 5 ? 'counted-src' : 'counted-lib',
            program: { program: 'checker.js', name: 'counted', concern: 'code', needs: [], params: { count: at < 5 ? 3 : 2 } },
          },
          places: [at < 5 ? 'src' : 'lib'],
          debt: [],
          checker,
        }));
        const launches: ProgramLaunch[] = [];
        const result = yield* judgePrograms(subject(root), bindings).pipe(Effect.provideService(ProgramRoad, localRoad(launches)));
        const answer = yield* Effect.fromResult(result.get(checker.id)!.answer);
        expect(launches).toHaveLength(1);
        const invocation = JSON.parse(launches[0]!.stdin) as ProgramInvocation;
        expect(invocation.keys).toHaveLength(2);
        expect(answer.map((one) => [one.rule, one.verdict.violations.length])).toEqual(
          bindings.map((one, at) => [one.rule, at < 5 ? 1 : 0]),
        );
        expect(answer[0]!.verdict.occurrences.map((one) => one.line)).toEqual([1, 2, 3]);
        expect(answer[0]!.verdict.baseOccurrences.map((one) => one.line)).toEqual([1, 2]);
        expect(answer[0]!.found[0]).not.toBe(answer[5]!.found[0]);
      }),
  );
});
