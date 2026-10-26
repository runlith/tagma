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
