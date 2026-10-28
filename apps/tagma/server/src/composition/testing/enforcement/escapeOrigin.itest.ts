import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Git } from '@runlith/git/Git';
import { commitOf, run } from '@runlith/git/repository';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { config } from '../../../config/config.js';
import { Configs } from '../../../config/contract/service/configs.js';
import { ProgramRoad } from '../../../executions/contract/service/programs.js';
import { localRoad } from '../../../executions/testing/road.js';
import {
  enforcementApplied,
  enforcementBaseOf,
  type Lanes,
  modulesDrawn,
  ruleRemeasured,
  withLanes,
  workerLanes,
} from '../../../enforcement/testing/wiring.js';
import { MeasuredCheckout } from '../../../graph/contract/service/serving.js';
import { demoGraphLayer, type EffectDemo, gitEffect, withDemo } from '../graphFixture.js';

type Traced = { readonly fingerprint: string; readonly commit: string; readonly changed?: 'check' };

const clean = 'export const a = 1;\nexport const b = 2;\n';
const large = `${clean}export const c = 3;\nexport const d = 4;\n`;

const rigOf = Effect.fnUntraced(function* (demo: EffectDemo) {
  const files = yield* FileSystem.FileSystem;
  const workers = yield* Effect.acquireRelease(
    Effect.sync(() => workerLanes('escape-origin')),
    (workers) => Effect.sync(() => workers.close()),
  );
  const configs = Context.get(
    yield* Layer.build(
      config.lifetimes.serving.pipe(
        Layer.provide(Layer.mergeAll(Layer.succeed(ProgramRoad, localRoad([])), Layer.succeed(Git, demo.graph.git), BunFileSystem.layer)),
      ),
    ),
    Configs,
  );
  const contextOf = (faces: Lanes) => withLanes(demo.context, faces).pipe(Context.add(Configs, configs));
  const context = contextOf(workers);
  const blind = (fingerprint: string): Lanes => ({
    ...workers,
    code: 'blind',
    reach: (ask, priority) =>
      Effect.map(workers.reach(ask, priority), (reading) => ({
        ...reading,
        verdict: { ...reading.verdict, violations: reading.verdict.violations.filter((one) => one.fingerprint !== fingerprint) },
      })),
  });
  const put = (path: string, text: string) => files.writeFileString(join(demo.demoRoot, path), text);
  const declare = (inspection: unknown) =>
    put('tagma.config.ts', `export default ${JSON.stringify({ inspections: { checked: inspection } })};\n`);
  const describe = (lines: number) =>
    declare({
      builtin: 'size',
      params: { base: 'src', files: { extensions: ['.ts'], exclude: [] }, thresholds: [{ glob: '**', metric: 'non-import', lines }] },
    });
  const commit = Effect.fnUntraced(function* (subject: string) {
    yield* gitEffect(demo.demoRoot, ['add', '-A']);
    yield* gitEffect(demo.demoRoot, ['commit', '-qm', subject]);
    const head = yield* commitOf(demo.graph.git, demo.demoRoot, 'HEAD');
    if (head === null) return yield* Effect.die('the committed fixture has no HEAD');
    return head;
  });
  const init = Effect.gen(function* () {
    yield* gitEffect(demo.demoRoot, ['init', '-q', '-b', 'main']);
    yield* gitEffect(demo.demoRoot, ['config', 'user.email', 'tagma@test']);
    yield* gitEffect(demo.demoRoot, ['config', 'user.name', 'tagma']);
  });
  const enforced = Effect.fnUntraced(function* (title: string) {
    const rule = yield* demo.graph.blocks.create({ projectId: demo.projectId, parentId: demo.root, tags: ['rule'], title });
    return { rule, name: yield* demo.nameOf(rule.id) };
  });
  const enforce = Effect.fnUntraced(
    function* (rule: Parameters<typeof enforcementBaseOf>[0], _faces?: Lanes) {
      yield* enforcementApplied(rule, {
        strictness: 'watch',
        inspection: 'checked',
        on: [{ op: 'submit_work', phase: 'before' }],
        caller: null,
        subjectOf: () => 'tree',
        base: yield* enforcementBaseOf(rule),
      });
    },
    (effect, _rule, faces = workers) => Effect.provide(effect, contextOf(faces)),
  );
  const draw = Effect.fnUntraced(
    function* (modules: readonly { readonly id: string; readonly root: string }[]) {
      const under = yield* demo.graph.blocks.rootBlockOf(demo.projectId);
      yield* modulesDrawn({
        projectId: demo.projectId,
        caller: null,
        subjectOf: () => null,
        modules: modules.map((one) => ({ ...one, title: one.id, under })),
      });
    },
    (effect) =>
      effect.pipe(Effect.provideService(MeasuredCheckout, { projectId: demo.projectId, path: demo.demoRoot }), Effect.provide(context)),
  );
  const remeasure = (name: string) => ruleRemeasured(demo.projectId, name).pipe(Effect.provide(context));
  const escapes = Effect.fnUntraced(function* (name: string) {
    const measured = yield* remeasure(name);
    expect(measured._tag).toBe('Measured');
    return measured._tag === 'Measured'
      ? measured.escaped.map(({ fingerprint, commit, changed }): Traced => ({ fingerprint, commit, changed }))
      : [];
  });
  const unavailable = Effect.fnUntraced(function* (commit: string) {
    const blob = (yield* run(demo.graph.git, demo.demoRoot, ['rev-parse', `${commit}:tagma.config.ts`], undefined)).trim();
    yield* files.remove(join(demo.demoRoot, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
    return blob;
  });
  return { files, put, declare, describe, commit, init, enforced, enforce, blind, draw, remeasure, escapes, unavailable };
});

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('escape origin', (it) => {
  it.effect('records the admitting code or config commit, including a violation brought by a merge parent', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { files, put, describe, commit, init, enforced, enforce, remeasure, escapes, unavailable } = yield* rigOf(demo);
        yield* files.makeDirectory(join(demo.demoRoot, 'src'));
        yield* put('src/code.ts', clean);
        yield* describe(3);
        yield* init;
        yield* commit('seed');
        const { rule, name } = yield* enforced('Small files');
        yield* enforce(rule);
        yield* put('src/code.ts', large);
        const codeCommit = yield* commit('introduce aggregate size violation');
        yield* put('src/code.ts', `${large}export const e = 5;\n`);
        yield* commit('grow an existing violation');
        expect(yield* escapes(name)).toEqual([{ fingerprint: 'code.ts', commit: codeCommit }]);
        yield* put('src/code.ts', clean);
        yield* commit('fix code');
        yield* remeasure(name);
        yield* describe(1);
        const configCommit = yield* commit('tighten inspection');
        yield* put('unrelated', 'harmless\n');
        yield* commit('later harmless landing');
        expect(yield* escapes(name)).toEqual([{ fingerprint: 'code.ts', commit: configCommit }]);
        yield* gitEffect(demo.demoRoot, ['checkout', '-qb', 'side']);
        yield* put('src/side.ts', large);
        const sideCommit = yield* commit('side violation');
        yield* gitEffect(demo.demoRoot, ['checkout', '-q', 'main']);
        yield* put('unrelated', 'main advances\n');
        yield* commit('main advance');
        yield* gitEffect(demo.demoRoot, ['merge', '--no-ff', '-qm', 'merge side', 'side']);
        expect(yield* escapes(name)).toEqual([{ fingerprint: 'side.ts', commit: sideCommit }]);
        expect((yield* demo.graph.blocks.blockById(rule.id)).fields.enforcement).toMatchObject({
          escaped: [
            { fingerprint: 'code.ts', commit: configCommit },
            { fingerprint: 'side.ts', commit: sideCommit },
          ],
        });
        const parent = yield* commitOf(demo.graph.git, demo.demoRoot, 'HEAD');
        if (parent === null) return yield* Effect.die('the committed fixture has no HEAD');
        const padding = Array.from(
          { length: 65 },
          (_, at) =>
            `commit refs/heads/main\nmark :${at + 1}\ncommitter tagma <tagma@test> ${at + 1} +0000\ndata 3\npad\nfrom ${at === 0 ? parent : `:${at}`}\n\n`,
        ).join('');
        yield* run(demo.graph.git, demo.demoRoot, ['fast-import', '--quiet'], undefined, padding);
        const undeclared = 'export default { inspections: {} };\n';
        yield* put('src/gap.ts', large);
        yield* put('tagma.config.ts', undeclared);
        const undeclaredCommit = yield* commit('introduce violation while the inspection is undeclared');
        yield* describe(1);
        const declaredCommit = yield* commit('declare the inspection again');
        const blob = yield* unavailable(undeclaredCommit);
        expect(yield* Effect.flip(remeasure(name))).toMatchObject({ _tag: 'OwnGitFailed' });
        expect((yield* run(demo.graph.git, demo.demoRoot, ['hash-object', '-w', '--stdin'], undefined, undeclared)).trim()).toBe(blob);
        expect(yield* escapes(name)).toEqual([{ fingerprint: 'gap.ts', commit: declaredCommit }]);
      }),
    ),
  );

  it.effect(
    'records a violation a changed inspection finds at the last measured version as that change’s, without measuring older versions',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { files, put, describe, commit, init, enforced, enforce, blind, escapes } = yield* rigOf(demo);
          yield* files.makeDirectory(join(demo.demoRoot, 'src'));
          yield* put('src/code.ts', clean);
          yield* describe(3);
          yield* init;
          yield* commit('seed');
          yield* put('src/code.ts', large);
          yield* commit('introduce a violation the earlier inspection does not see');
          yield* put('unrelated', 'harmless\n');
          const measured = yield* commit('the version the earlier inspection measures');
          const { rule, name } = yield* enforced('Small files');
          yield* enforce(rule, blind('code.ts'));
          yield* put('unrelated', 'later\n');
          yield* commit('later harmless commit');
          expect(yield* escapes(name)).toEqual([{ fingerprint: 'code.ts', commit: measured, changed: 'check' }]);
        }),
      ),
  );

  it.effect('names a load known only at run time unjudged and traces a crossing past one standing in its own file', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { files, put, declare, commit, init, enforced, enforce, draw, escapes } = yield* rigOf(demo);
        const loading = 'export const load = (name: string) => import(name);\n';
        yield* files.makeDirectory(join(demo.demoRoot, 'src/a'), { recursive: true });
        yield* files.makeDirectory(join(demo.demoRoot, 'src/b'), { recursive: true });
        yield* put('src/a/page.ts', 'export const page = 1;\n');
        yield* put('src/b/reader.ts', loading);
        yield* declare({ builtin: 'modules', params: { base: 'src' } });
        yield* init;
        yield* commit('seed');
        yield* draw([
          { id: 'a', root: 'src/a' },
          { id: 'b', root: 'src/b' },
        ]);
        const { rule, name } = yield* enforced('Import along relations');
        yield* enforce(rule);
        yield* put('unrelated', 'harmless\n');
        yield* commit('harmless');
        yield* put('src/b/reader.ts', `${loading}export const pages = import.meta.glob('../a/*.ts');\n`);
        const globbed = yield* commit('glob the pages of a');
        expect(yield* escapes(name)).toEqual([{ fingerprint: 'b -> a @ b/reader.ts', commit: globbed }]);
        expect((yield* demo.graph.blocks.blockById(rule.id)).fields.enforcement).toMatchObject({
          debt: [],
          escaped: [{ fingerprint: 'b -> a @ b/reader.ts', commit: globbed }],
        });
      }),
    ),
  );

  it.effect(
    'records a crossing a widened reach finds at the last measured version as that change’s, and traces another past versions older than tagma.config.ts',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { files, put, declare, commit, init, enforced, enforce, draw, remeasure, escapes } = yield* rigOf(demo);
          const inspection = { builtin: 'modules', params: { base: 'src', unresolved: 'unjudged' } };
          const crossing = "import { kept } from '../a/kept.js';\nexport const read = kept;\n";
          yield* files.makeDirectory(join(demo.demoRoot, 'src/a'), { recursive: true });
          yield* files.makeDirectory(join(demo.demoRoot, 'src/b'), { recursive: true });
          yield* put('src/a/kept.ts', 'export const kept = 1;\n');
          yield* put('src/b/notes.ts', "import notes from './missing.js';\nexport const text = notes;\n");
          yield* put('src/b/reader.ts', 'export const read = 1;\n');
          yield* init;
          const seed = yield* commit('seed before any config');
          yield* declare(inspection);
          yield* commit('declare the inspection');
          yield* put('src/b/reader.ts', crossing);
          const crossed = yield* commit('cross into a');
          yield* draw([
            { id: 'a', root: 'src/a' },
            { id: 'b', root: 'src/b' },
          ]);
          const { rule, name } = yield* enforced('Import along relations under a');
          yield* demo.graph.sources.attach({ blockId: rule.id, kind: 'dir', ref: 'src/a' });
          yield* enforce(rule);
          expect(yield* remeasure(name)).toMatchObject({ _tag: 'Measured', escaped: [] });
          yield* demo.graph.sources.attach({ blockId: rule.id, kind: 'dir', ref: 'src/b' });
          yield* put('unrelated', 'harmless\n');
          yield* commit('later harmless commit');
          expect(yield* escapes(name)).toEqual([{ fingerprint: 'b -> a @ b/reader.ts', commit: crossed, changed: 'check' }]);
          yield* gitEffect(demo.demoRoot, ['reset', '-q', '--hard', seed]);
          yield* declare(inspection);
          yield* commit('declare the inspection');
          yield* put('src/b/other.ts', crossing);
          const again = yield* commit('cross into a from another file');
          expect(yield* escapes(name)).toEqual([{ fingerprint: 'b -> a @ b/other.ts', commit: again }]);
        }),
      ),
  );
});
