import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Layer, Context } from 'effect';
import { ProgramRoad, type ProgramLaunch } from '../../executions/contract/service/programs.js';
import { localRoad } from '../../executions/testing/road.js';
import type { Programmed } from '../contract/wire/document.js';
import { Inspections, inspections } from '../workers/inspectionLanes.js';
import { checkerFor } from './checker.js';
import { committed, testGit } from './fixture.js';
import { judgePrograms, type GroupSubject, type ProgramBinding } from './group.js';

const PROGRAM = `import { defineProgram } from '@runlith/tagma/rules';
const marked = (marker) => async (side) => {
  const findings = [];
  for (const path of side.paths) {
    ((await side.read(path)) ?? '').split('\\n').forEach((line, at) => {
      if (line.includes(marker)) findings.push({ fingerprint: path + ' ' + marker, path, line: at + 1, message: marker });
    });
  }
  return { findings };
};
export default defineProgram({
  todo: async ({ tree, base }) => ({ tree: await marked('TODO')(tree), base: base === null ? undefined : await marked('TODO')(base) }),
  fixme: async ({ tree, base }) => ({ tree: await marked('FIXME')(tree), base: base === null ? undefined : await marked('FIXME')(base) }),
});
`;

const SARIF = `const results = [];
for (const path of process.argv.slice(2)) {
  (await Bun.file(path).text()).split('\\n').forEach((line, at) => {
    if (line.trim() === 'debugger;') results.push({ ruleId: 'no-debugger', message: { text: 'debugger' }, locations: [{ physicalLocation: { artifactLocation: { uri: path }, region: { startLine: at + 1 } } }] });
  });
}
console.log(JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'any-linter' } }, results }] }));
`;

const base = { 'lib/b.ts': '// TODO keep\n' };
const built = { 'lib/b.ts': '// TODO keep\n// FIXME now\ndebugger;\ndebugger;\n' };

const side = (name: 'tree' | 'base', files: Readonly<Record<string, string>>) => ({
  side: name,
  paths: Object.keys(files),
  files: Object.entries(files).map(([path, text]) => ({ path, text })),
});

class World extends Context.Service<
  World,
  { readonly root: string; readonly head: string; readonly lanes: ReturnType<typeof inspections> }
>()('test/CommandWorld') {}

const world = Layer.effect(
  World,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'command-runner-' }));
    const lanes = yield* Effect.acquireRelease(
      Effect.sync(() => inspections()),
      (opened) => Effect.sync(() => opened.close()),
    );
    mkdirSync(join(root, 'checks'), { recursive: true });
    mkdirSync(join(root, 'node_modules'));
    symlinkSync(resolve(import.meta.dir, '../../../../../../node_modules/oxlint'), join(root, 'node_modules/oxlint'));
    writeFileSync(
      join(root, 'checks/law.json'),
      JSON.stringify({ plugins: [], categories: { correctness: 'off' }, rules: { 'eslint/no-debugger': 'error' } }),
    );
    writeFileSync(join(root, 'checks/program.ts'), PROGRAM);
    writeFileSync(join(root, 'checks/sarif.ts'), SARIF);
    return World.of({ root, lanes, head: committed(root, ['checks']) });
  }),
).pipe(Layer.provide(BunFileSystem.layer));

const judged = Effect.fnUntraced(function* (checks: readonly Programmed[], launches: ProgramLaunch[]) {
  const { root, head, lanes } = yield* World;
  const subject: GroupSubject = {
    projectId: 1,
    root,
    tree: head,
    base: 'base',
    caller: { _tag: 'Operator' },
    sides: [side('tree', built), side('base', base)],
  };
  const bindings: ProgramBinding[] = checks.map((check) => ({
    rule: check.key,
    check,
    places: ['lib'],
    debt: [],
    checker: checkerFor(root, check),
  }));
  const groups = yield* judgePrograms(subject, bindings).pipe(
    Effect.provideService(ProgramRoad, localRoad(launches)),
    Effect.provideService(Inspections, Inspections.of(lanes)),
    Effect.provide(testGit),
  );
  const readings = yield* Effect.forEach([...groups.values()], (run) => Effect.fromResult(run.answer));
  return new Map(
    readings.flat().map((one) => [one.rule, one.verdict.violations.map((found) => [found.fingerprint, found.file, found.value])]),
  );
});

layer(world, { excludeTestServices: true })('custom inspections and linters from the config', (it) => {
  it.effect('two keys of one defineProgram module run in one process and judge the change, each under its key', () =>
    Effect.gen(function* () {
      const launches: ProgramLaunch[] = [];
      const program = (key: string, name: string): Programmed => ({
        key,
        program: { program: 'checks/program.ts', name, concern: 'code', needs: [], params: {} },
      });
      const found = yield* judged([program('todos', 'todo'), program('fixmes', 'fixme')], launches);
      expect(launches).toHaveLength(1);
      expect(Object.fromEntries(found)).toEqual({
        todos: [],
        fixmes: [['fixmes lib/b.ts FIXME', 'lib/b.ts', undefined]],
      });
    }),
  );

  it.effect('a command printing SARIF judges a rule as the named adapter judges it', () =>
    Effect.gen(function* () {
      const { root } = yield* World;
      const found = yield* judged(
        [
          { key: 'named', program: { linter: { tool: 'oxlint', config: 'checks/law.json' }, rule: 'eslint/no-debugger' } },
          {
            key: 'command',
            program: { linter: { tool: 'command', argv: ['bun', join(root, 'checks/sarif.ts')], output: 'sarif' }, rule: 'no-debugger' },
          },
        ],
        [],
      );
      expect(found.get('named')).toEqual([['named lib/b.ts', 'lib/b.ts', 2]]);
      expect(found.get('command')).toEqual([['command lib/b.ts', 'lib/b.ts', 2]]);
    }),
  );
});
