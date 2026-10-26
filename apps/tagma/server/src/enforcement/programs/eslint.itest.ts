import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import type { ProgramInvocation, ProgramKey } from '@tagma/inspection/program';
import { gitLayer } from '@runlith/git/Git';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { ProgramRoad, type ProgramLaunch } from '../../executions/contract/service/programs.js';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import type { Checker } from './checker.js';
import { Inspections, inspections } from '../workers/inspectionLanes.js';
import { eslintAnswer } from './eslint.js';
import { localRoad } from '../../executions/testing/road.js';
import { scratchTemp } from './fixture.js';
import { type GroupSubject, judgePrograms, type ProgramBinding } from './group.js';

const git = gitLayer.pipe(
  Layer.provide(BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)))),
);

class World extends Context.Service<
  World,
  {
    readonly env: string;
    readonly head: string;
    readonly checker: Checker;
    readonly lanes: ReturnType<typeof inspections>;
  }
>()('test/EslintWorld') {}

const world = Layer.effect(
  World,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const env = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'eslint-runner-' }));
    const lanes = yield* Effect.acquireRelease(
      Effect.sync(() => inspections()),
      (opened) => Effect.sync(() => opened.close()),
    );
    mkdirSync(join(env, 'checks'), { recursive: true });
    mkdirSync(join(env, 'node_modules'));
    for (const name of ['eslint', 'eslint-plugin-svelte', 'svelte-eslint-parser', 'svelte']) {
      symlinkSync(resolve(import.meta.dir, '../../../../../../node_modules', name), join(env, 'node_modules', name));
    }
    writeFileSync(
      join(env, 'checks/law.config.js'),
      `import svelte from 'eslint-plugin-svelte';
export default [...svelte.configs.base, { files: ['**/*.svelte'], languageOptions: { parserOptions: { svelteConfig: {} } } },
  { rules: { 'no-console': 'error' } }];\n`,
    );
    mkdirSync(join(env, 'src'));
    writeFileSync(join(env, '.gitignore'), 'node_modules\n');
    writeFileSync(join(env, 'package.json'), '{}');
    writeFileSync(join(env, 'src/A.svelte'), "<script>\n  const tag = 'task';\n  console.log(tag);\n</script>\n<p>{tag}</p>\n");
    for (const argv of [
      ['init', '-q'],
      ['add', '.'],
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'reach'],
    ]) {
      const done = yield* spawnedEffect(['git', ...argv], { cwd: env });
      if (!done.success) return yield* Effect.die(`git ${argv.join(' ')} failed`);
    }
    const head = (yield* spawnedEffect(['git', 'rev-parse', 'HEAD'], { cwd: env })).stdout.toString().trim();
    const checker: Checker = {
      id: 'law-eslint',
      launch: [process.execPath, '--no-install'],
      cwd: env,
      descriptor: { id: 'law-eslint', adapter: 'eslint', config: 'checks/law.config.js', layout: 'files' },
    };
    return World.of({ env, head, checker, lanes });
  }),
).pipe(Layer.provide(BunFileSystem.layer));

const sideOf = (name: 'tree' | 'base', files: Readonly<Record<string, string>>) => ({
  side: name,
  paths: Object.keys(files),
  files: Object.entries(files).map(([path, text]) => ({ path, text })),
});

layer(world, { excludeTestServices: true })('eslint program', (it) => {
  it.effect('one ESLint process reads both sides from a scratch layout it removes', () =>
    Effect.gen(function* () {
      const { env, head, checker, lanes } = yield* World;
      const { temp } = yield* scratchTemp('eslint-scratch-');
      const keys: [ProgramKey, ...ProgramKey[]] = [{ key: '0', id: 'no-console', params: {}, reach: { places: ['src'] } }];
      const input: ProgramInvocation = {
        request: 'r1',
        checker: 'c1',
        root: env,
        tree: head,
        base: 'base',
        keys,
        sides: [sideOf('tree', { 'src/a.js': 'console.log(1);\nconsole.log(2);\n' }), sideOf('base', { 'src/a.js': 'console.log(1);\n' })],
      };
      const launches: ProgramLaunch[] = [];
      const answer = yield* eslintAnswer(localRoad(launches), {
        projectId: 1,
        root: env,
        actor: { _tag: 'Operator' },
        input,
        checker,
        covers: () => true,
      }).pipe(Effect.provideService(Inspections, Inspections.of(lanes)), Effect.provide(git));
      expect(launches).toHaveLength(1);
      expect(answer.readings.map((one) => [one.side, one.findings.map((found) => [found.path, found.value])])).toEqual([
        ['tree', [['src/a.js', 2]]],
        ['base', [['src/a.js', 1]]],
      ]);
      expect(readdirSync(temp)).toEqual([]);
    }),
  );

  it.effect('rules bound to one ESLint runner for scripts and for .svelte judge both sides with one process, each over its own files', () =>
    Effect.gen(function* () {
      const { env, head, checker, lanes } = yield* World;
      const subject: GroupSubject = {
        projectId: 1,
        root: env,
        tree: head,
        base: 'base',
        caller: { _tag: 'Operator' },
        sides: [
          sideOf('tree', {
            'src/a.js': 'console.log(1);\nconsole.log(2);\n',
            'src/A.svelte': '<script>\n  console.log(1);\n</script>\n<p>{console.log(2)}</p>\n',
          }),
          sideOf('base', { 'src/a.js': 'noop();\n', 'src/A.svelte': '<p>a</p>\n' }),
        ],
      };
      const bindings: ProgramBinding[] = [
        ['scripts', '**/*.js'],
        ['components', '**/*.svelte'],
      ].map(([rule, glob]) => ({
        rule: rule!,
        check: {
          key: `no-console-${rule}`,
          program: { linter: { tool: 'eslint', config: 'checks/law.config.js' }, rule: 'no-console', files: [glob!] },
        },
        places: ['src'],
        debt: [],
        checker,
      }));
      const launches: ProgramLaunch[] = [];
      const answers = yield* judgePrograms(subject, bindings).pipe(
        Effect.provideService(ProgramRoad, localRoad(launches)),
        Effect.provideService(Inspections, Inspections.of(lanes)),
        Effect.provide(git),
      );
      const answer = yield* Effect.fromResult(answers.get(checker.id)!.answer);
      expect(launches).toHaveLength(1);
      expect(answer.map((one) => [one.rule, one.verdict.violations.map((found) => [found.file, found.value])])).toEqual([
        ['scripts', [['src/a.js', 2]]],
        ['components', [['src/A.svelte', 2]]],
      ]);
    }),
  );

  it.effect('a whole-reach reading lays the reach out from the judged tree, .svelte included', () =>
    Effect.gen(function* () {
      const { env, head, checker, lanes } = yield* World;
      const keys: [ProgramKey, ...ProgramKey[]] = [{ key: '0', id: 'no-console', params: {}, reach: { places: ['src'] } }];
      const answer = yield* eslintAnswer(localRoad([]), {
        projectId: 1,
        root: env,
        actor: { _tag: 'Operator' },
        checker,
        covers: () => true,
        input: {
          request: 'r2',
          checker: 'law-eslint',
          root: env,
          tree: head,
          base: null,
          keys,
          sides: [{ side: 'tree', paths: null, files: null }],
        },
      }).pipe(Effect.provideService(Inspections, Inspections.of(lanes)), Effect.provide(git));
      expect(answer.readings.map((one) => [one.key, one.findings.map((found) => found.path)])).toEqual([['0', ['src/A.svelte']]]);
    }),
  );
});
