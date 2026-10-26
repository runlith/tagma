import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem, Layer, Result, Tracer } from 'effect';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { ProgramRoad, type ProgramLaunch } from '../../executions/contract/service/programs.js';
import { Inspections, inspections } from '../workers/inspectionLanes.js';
import type { Checker } from './checker.js';
import { localRoad } from '../../executions/testing/road.js';
import { scratchTemp, testGit as git } from './fixture.js';
import { judgePrograms, type GroupSubject, type ProgramBinding } from './group.js';

const base = {
  'src/a.ts': 'noop();\n',
  'lib/b.ts': 'debugger;\n',
};
const built = {
  'src/a.ts': 'console.log(1);\nconsole.log(2);\n',
  'lib/b.ts': '\n\ndebugger;\n',
};
const oxlint = (rule: string): ProgramBinding['check'] => ({
  key: rule.replace('eslint/', ''),
  program: { linter: { tool: 'oxlint', config: 'checks/law.json' }, rule },
});
const side = (name: 'tree' | 'base', files: Readonly<Record<string, string>>) => ({
  side: name,
  paths: Object.keys(files),
  files: Object.entries(files).map(([path, text]) => ({ path, text })),
});

class World extends Context.Service<
  World,
  {
    readonly env: string;
    readonly head: string;
    readonly checker: Checker;
    readonly lanes: ReturnType<typeof inspections>;
  }
>()('test/OxlintWorld') {}

const world = Layer.effect(
  World,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const env = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'oxlint-runner-' }));
    const lanes = yield* Effect.acquireRelease(
      Effect.sync(() => inspections()),
      (opened) => Effect.sync(() => opened.close()),
    );
    mkdirSync(join(env, 'checks'), { recursive: true });
    mkdirSync(join(env, 'node_modules'));
    symlinkSync(resolve(import.meta.dir, '../../../../../../node_modules/oxlint'), join(env, 'node_modules/oxlint'));
    writeFileSync(
      join(env, 'checks/law.json'),
      JSON.stringify({
        plugins: [],
        categories: { correctness: 'off' },
        rules: { 'eslint/no-console': 'error', 'eslint/no-debugger': 'error' },
      }),
    );
    const checker: Checker = {
      id: 'law-oxlint',
      descriptor: { id: 'law-oxlint', adapter: 'oxlint', config: './checks/law.json', layout: 'files' },
      launch: [process.execPath, '--no-install'],
      cwd: env,
    };
    mkdirSync(join(env, 'src'));
    writeFileSync(join(env, '.gitignore'), 'node_modules\n');
    writeFileSync(join(env, 'src/a.ts'), built['src/a.ts']);
    writeFileSync(join(env, 'src/notes.md'), 'task');
    for (const argv of [
      ['init', '-q'],
      ['add', '.'],
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'reach'],
    ]) {
      const done = yield* spawnedEffect(['git', ...argv], { cwd: env });
      if (!done.success) return yield* Effect.die(`git ${argv.join(' ')} failed`);
    }
    const head = (yield* spawnedEffect(['git', 'rev-parse', 'HEAD'], { cwd: env })).stdout.toString().trim();
    return World.of({ env, head, checker, lanes });
  }),
).pipe(Layer.provide(BunFileSystem.layer));

layer(world, { excludeTestServices: true })('oxlint program', (it) => {
  it.effect('ten rules on one oxlint runner judge both sides with one process', () =>
    Effect.gen(function* () {
      const { env, head, checker, lanes } = yield* World;
      const subject: GroupSubject = {
        projectId: 1,
        root: env,
        tree: head,
        base: 'base',
        caller: { _tag: 'Operator' },
        sides: [side('tree', built), side('base', base)],
      };
      const bindings: ProgramBinding[] = Array.from({ length: 10 }, (_, at) => ({
        rule: `rule-${at}`,
        check: oxlint(at < 5 ? 'eslint/no-console' : 'eslint/no-debugger'),
        places: [at < 5 ? 'src' : 'lib'],
        debt: [],
        checker,
      }));
      const launches: ProgramLaunch[] = [];
      const spans: Tracer.NativeSpan[] = [];
      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const result = yield* judgePrograms(subject, bindings).pipe(
        Effect.provideService(ProgramRoad, localRoad(launches)),
        Effect.provideService(Inspections, Inspections.of(lanes)),
        Effect.withTracer(tracer),
        Effect.provide(git),
      );
      const run = spans.find((span) => span.name === 'enforcement.program.oxlint.run');
      expect(run?.attributes.get('checker.processes')).toBe(1);
      expect(run?.attributes.get('checker.keys')).toBe(2);
      const answer = yield* Effect.fromResult(result.get(checker.id)!.answer);
      expect(launches).toHaveLength(1);
      expect(answer.map((one) => [one.rule, one.verdict.violations.map((found) => [found.file, found.value])])).toEqual(
        bindings.map((one, at) => [one.rule, at < 5 ? [['src/a.ts', 2]] : []]),
      );
      expect(answer[5]!.found).toHaveLength(1);
    }),
  );

  it.effect('a scratch layout that fails part-way is removed with the judgement', () =>
    Effect.gen(function* () {
      const { env, head, checker, lanes } = yield* World;
      const { temp } = yield* scratchTemp('oxlint-scratch-');
      const clashing = { 'src/a.ts': 'console.log(1);\n', 'src/a.ts/b.ts': 'console.log(2);\n' };
      const subject: GroupSubject = {
        projectId: 1,
        root: env,
        tree: head,
        base: null,
        caller: { _tag: 'Operator' },
        sides: [side('tree', clashing)],
      };
      const launches: ProgramLaunch[] = [];
      const result = yield* judgePrograms(subject, [
        { rule: 'rule-0', check: oxlint('eslint/no-console'), places: ['src'], debt: [], checker },
      ]).pipe(
        Effect.provideService(ProgramRoad, localRoad(launches)),
        Effect.provideService(Inspections, Inspections.of(lanes)),
        Effect.provide(git),
      );
      expect(Result.isFailure(result.get(checker.id)!.answer)).toBe(true);
      expect(launches).toHaveLength(0);
      expect(readdirSync(temp)).toEqual([]);
    }),
  );

  it.effect('a whole-reach measurement lays the reach out from the judged tree', () =>
    Effect.gen(function* () {
      const { env, head, checker, lanes } = yield* World;
      const subject: GroupSubject = {
        projectId: 1,
        root: env,
        tree: head,
        base: null,
        caller: { _tag: 'Operator' },
        sides: [{ side: 'tree', paths: null, files: null }],
      };
      const launches: ProgramLaunch[] = [];
      const result = yield* judgePrograms(subject, [
        { rule: 'rule-0', check: oxlint('eslint/no-console'), places: ['src'], debt: [], checker },
      ]).pipe(
        Effect.provideService(ProgramRoad, localRoad(launches)),
        Effect.provideService(Inspections, Inspections.of(lanes)),
        Effect.provide(git),
      );
      const answer = yield* Effect.fromResult(result.get(checker.id)!.answer);
      expect(launches).toHaveLength(1);
      expect(answer[0]!.verdict.violations.map((one) => [one.file, one.value])).toEqual([['src/a.ts', 2]]);
    }),
  );
});
