import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import type { ProgramInvocation } from '@tagma/inspection/program';
import { gitLayer } from '@runlith/git/Git';
import { Context, Effect, FileSystem, Layer, Result } from 'effect';
import { ProgramRoad, type ProgramLaunch } from '../../executions/contract/service/programs.js';
import { Inspections } from '../workers/inspectionLanes.js';
import { localRoad } from '../../executions/testing/road.js';
import { judgeBindings } from './bindings.js';

const checker = `const read = async (side) => {
  await Promise.all(side.paths.map((path) => side.read(path)));
  return { covered: 'paths', findings: [] };
};
export default { migrations: async ({ tree, base }) => ({ tree: await read(tree), base: base === null ? undefined : await read(base) }) };`;

const unused = () => Effect.die('a program binding runs no builtin inspection');

const inspections: Inspections['Service'] = { reach: unused, judge: unused, packs: unused, facts: unused, history: unused };

const binary = new Uint8Array([0x69, 0x63, 0x6e, 0x73, 0x00, 0xff, 0xfe, 0x80]);

class Repo extends Context.Service<
  Repo,
  { readonly root: string; readonly base: string; readonly commit: (files: Record<string, Planted>) => Effect.Effect<string> }
>()('test/BindingsRepo') {}

type Planted = string | Uint8Array | { readonly link: string };

const repo = Layer.effect(
  Repo,
  Effect.gen(function* () {
    const root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'tagma-bindings-' });
    const git = (...args: string[]) => Effect.promise(() => Bun.$`git -c user.name=t -c user.email=t@t -C ${root} ${args}`.quiet());
    const commit = Effect.fnUntraced(function* (files: Record<string, Planted>) {
      for (const [path, planted] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        if (typeof planted === 'object' && 'link' in planted) symlinkSync(planted.link, join(root, path));
        else writeFileSync(join(root, path), planted);
      }
      yield* git('add', '--', ...Object.keys(files));
      yield* git('commit', '-q', '-m', 'step');
      return (yield* Effect.promise(() => Bun.$`git -C ${root} rev-parse HEAD`.quiet().text())).trim();
    });
    yield* git('init', '-q');
    const base = yield* commit({
      'checks/fixture.js': checker,
      'src/table.ts': 'export const table = 1;\n',
    });
    return Repo.of({ root, base, commit });
  }),
).pipe(Layer.provide(BunFileSystem.layer));

const judged = Effect.fnUntraced(function* (built: string, paths: readonly string[], launches: ProgramLaunch[]) {
  const { root, base } = yield* Repo;
  return yield* judgeBindings({ projectId: 1, root, built, base, paths, caller: { _tag: 'Operator' }, lane: 'landing' }, [
    {
      rule: 'migrations',
      inspection: {
        key: 'migrations',
        program: {
          program: 'checks/fixture.js',
          name: 'migrations',
          concern: 'code',
          needs: [],
          params: {},
          files: ['src/**/*.ts', 'drizzle/**'],
        },
      },
      places: [''],
      debt: [],
    },
  ]).pipe(
    Effect.provide(
      Layer.mergeAll(
        gitLayer.pipe(Layer.provide(BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))))),
        Layer.succeed(Inspections, inspections),
        Layer.succeed(ProgramRoad, localRoad(launches)),
      ),
    ),
  );
});

layer(repo, { excludeTestServices: true })('program bindings', (it) => {
  it.effect('a binary file outside the files a program binding reaches is neither read nor failed', () =>
    Effect.gen(function* () {
      const built = yield* (yield* Repo).commit({ 'assets/Tagma.icns': binary, 'src/table.ts': 'export const table = 2;\n' });
      const launches: ProgramLaunch[] = [];
      yield* Effect.fromResult((yield* judged(built, ['assets/Tagma.icns', 'src/table.ts'], launches)).get('migrations')!.answer);
      expect(launches).toHaveLength(1);
      const invocation = JSON.parse(launches[0]!.stdin) as ProgramInvocation;
      expect(invocation.sides.map((side) => [side.side, side.paths])).toEqual([
        ['tree', ['src/table.ts']],
        ['base', ['src/table.ts']],
      ]);
    }),
  );

  it.effect('a symlink the binding reaches is no source file: it is neither read nor failed', () =>
    Effect.gen(function* () {
      const built = yield* (yield* Repo).commit({ 'drizzle/skill': { link: '../src' }, 'src/table.ts': 'export const table = 3;\n' });
      const launches: ProgramLaunch[] = [];
      yield* Effect.fromResult((yield* judged(built, ['drizzle/skill', 'src/table.ts'], launches)).get('migrations')!.answer);
      const invocation = JSON.parse(launches[0]!.stdin) as ProgramInvocation;
      expect(invocation.sides.map((side) => [side.side, side.paths])).toEqual([
        ['tree', ['src/table.ts']],
        ['base', ['src/table.ts']],
      ]);
    }),
  );

  it.effect('a file the binding reaches that is not UTF-8 text fails the judgement, naming its path', () =>
    Effect.gen(function* () {
      const built = yield* (yield* Repo).commit({ 'src/broken.ts': binary });
      const answer = (yield* judged(built, ['src/broken.ts'], [])).get('migrations')!.answer;
      expect(Result.isFailure(answer) && answer.failure.reason).toContain('src/broken.ts');
    }),
  );
});
