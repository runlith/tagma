import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ProgramFacts, ProgramInvocation } from '@tagma/inspection/program';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { ProgramRoad, type ProgramLaunch } from '../../executions/contract/service/programs.js';
import type { Checker } from './checker.js';
import { answer } from '../workers/inspecting.js';
import { Inspections, inspections } from '../workers/inspectionLanes.js';
import { localRoad } from '../../executions/testing/road.js';
import { judgePrograms, type ProgramBinding } from './group.js';

const program = `const input = JSON.parse(await Bun.stdin.text());
const findings = (side) => {
  const read = input.facts.sides.find((one) => one.side === side);
  return read.files.flatMap((file) => (file.imports ?? []).filter((one) => 'path' in one.target).map((one) => (
    { fingerprint: file.path + ' -> ' + one.target.path, path: file.path, line: one.line, message: one.kind }
  )));
};
console.log(JSON.stringify({
  request: input.request, checker: input.checker, tree: input.tree, base: input.base,
  run: { tool: 'facts-fixture', version: '1', capabilities: {} },
  readings: input.keys.flatMap((key) => input.sides.map((side) => ({ key: key.key, side: side.side, covered: { scope: 'reach' }, unjudged: [], findings: findings(side.side) }))),
}));`;

class Repo extends Context.Service<
  Repo,
  {
    readonly root: string;
    readonly base: string;
    readonly built: string;
    readonly checker: Checker;
    readonly lanes: ReturnType<typeof inspections>;
    readonly revParse: (ref: string) => Effect.Effect<string>;
  }
>()('test/FactsRepo') {}

const repo = Layer.effect(
  Repo,
  Effect.gen(function* () {
    const root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'tagma-facts-' });
    const lanes = yield* Effect.acquireRelease(
      Effect.sync(() => inspections()),
      (opened) => Effect.sync(() => opened.close()),
    );
    const git = (...args: string[]) => Effect.promise(() => Bun.$`git -c user.name=t -c user.email=t@t -C ${root} ${args}`.quiet());
    const revParse = (ref: string) => Effect.promise(async () => (await Bun.$`git -C ${root} rev-parse ${ref}`.quiet().text()).trim());
    const commit = Effect.fnUntraced(function* (files: Record<string, string>) {
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
      }
      yield* git('add', '-A');
      yield* git('commit', '-q', '-m', 'step');
      return yield* revParse('HEAD');
    });
    yield* git('init', '-q');
    writeFileSync(join(root, 'checker.js'), program);
    const base = yield* commit({
      'src/a.ts': "import { b } from './b';\nexport const a = b;\n",
      'src/b.ts': 'export const b = 1;\n',
      'src/broken.ts': 'export const = ;\n',
    });
    const built = yield* commit({
      'src/a.ts': "import { b } from './b';\nimport type { C } from './c';\nexport const a = b;\n",
      'src/c.ts': 'export type C = 1;\n',
      'src/broken.ts': 'export const fixed = 1;\n',
    });
    const checker: Checker = {
      id: 'facts',
      descriptor: {
        id: 'facts',
        adapter: 'program',
        argv: [process.execPath, 'checker.js'],
        layout: 'program',
        needs: { facts: ['imports'] },
      },
      launch: [process.execPath, join(root, 'checker.js')],
      cwd: root,
    };
    return Repo.of({ root, base, built, checker, lanes, revParse });
  }),
).pipe(Layer.provide(BunFileSystem.layer));

layer(repo, { excludeTestServices: true })('program facts', (it) => {
  it.effect(
    'a program declaring imports receives resolved edges of both sides, named by adapter and tree, and judges them without parsing',
    () =>
      Effect.gen(function* () {
        const { root, base, built, checker, lanes, revParse } = yield* Repo;
        const launches: ProgramLaunch[] = [];
        const binding: ProgramBinding = {
          rule: 'rule',
          check: {
            key: 'edges',
            program: { program: 'checker.js', name: 'edges', concern: 'imports', needs: ['imports'], params: {} },
          },
          places: ['src'],
          debt: [],
          checker,
        };
        const paths = ['src/a.ts', 'src/broken.ts'];
        const subject = {
          projectId: 1,
          root,
          tree: built,
          base,
          caller: { _tag: 'Operator' } as const,
          sides: [
            { side: 'tree', paths, files: [] },
            { side: 'base', paths, files: [] },
          ] as const,
        };
        const result = yield* judgePrograms(subject, [binding]).pipe(
          Effect.provideService(ProgramRoad, localRoad(launches)),
          Effect.provideService(Inspections, Inspections.of(lanes)),
        );
        const reading = yield* Effect.fromResult(result.get(checker.id)!.answer);
        expect(reading[0]!.verdict.violations.map((one) => one.fingerprint.split(' ').slice(1).join(' '))).toEqual([
          'src/a.ts -> src/c.ts',
        ]);
        const facts = (JSON.parse(launches[0]!.stdin) as ProgramInvocation).facts as ProgramFacts;
        expect(facts.adapters.map((one) => one.id)).toContain('js');
        expect(facts.bytes).toBe(Buffer.byteLength(JSON.stringify(facts)));
        const trees = yield* Effect.forEach([built, base], (one) => revParse(`${one}^{tree}`));
        expect(facts.sides.map(({ side, commit, tree, complete }) => ({ side, commit, tree, complete }))).toEqual([
          { side: 'tree', commit: built, tree: trees[0]!, complete: true },
          { side: 'base', commit: base, tree: trees[1]!, complete: false },
        ]);
        expect(facts.sides[0]!.files.find((one) => one.path === 'src/a.ts')?.imports?.map(({ kind, target }) => [kind, target])).toEqual([
          ['value', { path: 'src/b.ts' }],
          ['type', { path: 'src/c.ts' }],
        ]);
        expect(facts.sides[1]!.files.find((one) => one.path === 'src/broken.ts')?.unjudged).toContain('does not parse');
        expect(facts.sides[0]!.reached.map((one) => one.path)).toEqual(['src/b.ts', 'src/c.ts']);
      }),
  );

  it.effect(
    'a snapshot above its ceiling fails the inspection naming the size it needed, and a built side that does not parse fails it too',
    () =>
      Effect.gen(function* () {
        const { root, base, built } = yield* Repo;
        const ask = { kind: 'facts' as const, root, reaches: [{ places: ['src'] }], needs: ['imports' as const], context: {} };
        const over = yield* Effect.promise(() =>
          answer({ ...ask, id: 1, ceiling: 10, sides: [{ side: 'tree', commit: built, paths: ['src/a.ts'] }] }, 'judge'),
        );
        expect(over.answered ? 'answered' : [over.cause, /needs \d+ bytes, above the 10 bytes/.test(over.reason)]).toEqual([
          'envelope',
          true,
        ]);
        const broken = yield* Effect.promise(() =>
          answer({ ...ask, id: 2, ceiling: 1_000_000, sides: [{ side: 'tree', commit: base, paths: null }] }, 'judge'),
        );
        expect(broken.answered ? 'answered' : [broken.cause, broken.reason.includes('src/broken.ts')]).toEqual(['source', true]);
      }),
  );
});
