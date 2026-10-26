import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import {
  demoGraphLayer,
  type EffectDemo,
  gitEffect,
  graphFixture,
  rootFixture,
  tempRepoEffect,
  tempRootEffect,
  withDemo,
  zoneDeclared,
} from '../graphFixture.js';
import { fileReflection, filedReflections } from '../../../reflections/filing.js';

const source = demoGraphLayer({
  source: 'tagma-source',
  repos: ['tagma-source'],
  prepareEffect: Effect.fnUntraced(function* (demo) {
    const files = yield* FileSystem.FileSystem;
    const root = demo.project('tagma-source').root;
    yield* files.writeFileString(join(root, 'apps', 'x', 'fix'), 'before');
    yield* gitEffect(root, ['add', '-A']);
    yield* gitEffect(root, ['commit', '-qm', 'the tool as it failed']);
  }),
});
const filing = {
  title: 'the home of a reflection is measured, and a closure carries where it came from',
  command: 'file_reflection from a server running out of an installation closure',
  expected: 'the entry lands under the block covering Tagma’s own source',
  actual: 'it refused no-home',
};
const said = Effect.fn('reflection.git')(function* (cwd: string, args: string[]) {
  const run = yield* spawnedEffect(['git', ...args], { cwd });
  if (!run.success) return yield* Effect.die(new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`));
  return run.stdout.toString().trim();
});
const landed = Effect.fnUntraced(function* (repo: string, message: string) {
  yield* (yield* FileSystem.FileSystem).writeFileString(join(repo, 'apps', 'x', 'fix'), message);
  yield* gitEffect(repo, ['commit', '-qam', message]);
  return yield* said(repo, ['rev-parse', 'HEAD']);
});
const filedAgainstRepo = Effect.fnUntraced(function* (demo: EffectDemo) {
  const tagma = demo.project('tagma-source');
  const entry = (yield* fileReflection(filing)).entry.id;
  return { source: tagma.root, tagma, entry };
});

layer(BunFileSystem.layer, { excludeTestServices: true })('reflection closure provenance', (it) => {
  it.effect('a closure files under the checkout it was cut from, and one with no origin refuses naming its own place', () =>
    Effect.gen(function* () {
      const roots = yield* Effect.acquireRelease(Effect.sync(rootFixture), (fixture) => Effect.orDie(fixture.releaseEffect));
      const scope = yield* roots.openEffect;
      const root = yield* tempRepoEffect(scope, 'tagma-source-');
      const closure = yield* tempRootEffect(scope, 'tagma-closure-');
      const copies = graphFixture();
      yield* Effect.addFinalizer(() => Effect.orDie(copies.releaseEffect));
      const first = (yield* copies.openEffect({ sourcePath: closure, originPath: join(root, 'server') })).effects;
      yield* Effect.gen(function* () {
        const { graph } = first;
        const tagma = yield* graph.projectLifecycle.create({ name: 'closure-source', rootPath: root });
        yield* zoneDeclared(tagma.id);
        const area = yield* graph.blocks.create({ projectId: tagma.id, tags: ['zone'], title: 'The Server' });
        yield* graph.sources.attach({ blockId: area.id, kind: 'dir', ref: 'server' });
        const filed = yield* fileReflection(filing);
        expect(filed.entry.projectId).toBe(tagma.id);
        expect(filed.entry.parentId).toBe(area.id);
        expect((yield* first.table(tagma.id)).tagOf(filed.written)?.id).toBe('reflection');
      }).pipe(Effect.provide(first.context));
      yield* copies.releaseEffect;
      const second = (yield* copies.openEffect({ sourcePath: closure })).effects;
      yield* Effect.gen(function* () {
        yield* second.graph.projectLifecycle.create({ name: 'closure-source', rootPath: root });
        const refused = yield* second.refusal(fileReflection(filing));
        expect(refused.code).toBe('no-home');
        expect(refused.message).toContain(closure);
        expect(refused.unblock.length).toBeGreaterThan(0);
      }).pipe(Effect.provide(second.context));
    }),
  );
});

layer(Layer.merge(source, BunFileSystem.layer), { excludeTestServices: true })('reflection answers by landed work', (it) => {
  it.effect(
    'a direct fix answers its entry by the landed commit, recorded whole; the same answer again writes nothing, another refuses',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { source, entry } = yield* filedAgainstRepo(demo);
          const { graph } = demo;
          const fix = yield* landed(source, 'the tool fixed');
          yield* graph.reflection.answer({ id: entry, commit: fix.slice(0, 10) });
          expect((yield* filedReflections(undefined, 100)).rows.map((row) => row.id)).not.toContain(entry);
          expect(yield* graph.reading.show(entry, 0)).toMatchObject({
            answered: true,
            answeredBy: null,
            answeredCommit: fix,
            fields: { command: filing.command, expected: filing.expected, actual: filing.actual },
          });
          yield* graph.reflection.answer({ id: entry, commit: fix });
          const answers = (yield* graph.journal.events({ blockId: entry })).filter((row) => row.op === 'answer');
          expect(answers.map((row) => JSON.parse(row.payload))).toEqual([{ commit: fix }]);
          const earlier = yield* said(source, ['rev-parse', 'HEAD~1']);
          const other = yield* demo.refusal(graph.reflection.answer({ id: entry, commit: earlier }));
          expect(other.code).toBe('already-answered');
          expect(other.reason).toContain(fix);
        }),
      ),
  );

  it.effect(
    'a check that finds nothing to fix answers the entry with its finding and HEAD, and withdrawn it returns the entry to the friction',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { source, entry } = yield* filedAgainstRepo(demo);
          const { graph } = demo;
          const head = yield* said(source, ['rev-parse', 'HEAD']);
          const finding = 'CLI and native read_inspections answer the same measured rules on one server';
          yield* graph.reflection.answer({ id: entry, checked: finding });
          expect((yield* filedReflections(undefined, 100)).rows.map((row) => row.id)).not.toContain(entry);
          expect(yield* graph.reading.show(entry, 0)).toMatchObject({ answered: true, answeredCheck: { finding, head } });
          expect((yield* demo.refusal(graph.reflection.answer({ id: entry, commit: head }))).code).toBe('already-answered');
          yield* graph.reflection.unanswer({ id: entry, checked: true });
          expect(yield* graph.blockAnswers.answerOf(entry)).toBeNull();
          expect((yield* filedReflections(undefined, 100)).rows.map((row) => row.id)).toContain(entry);
        }),
      ),
  );

  it.effect('finished work that stood before answers by its block, and a commit named after it refuses', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { source, tagma, entry } = yield* filedAgainstRepo(demo);
        const { graph } = demo;
        const task = (yield* graph.blocks.create({ projectId: tagma.id, tags: ['task'], title: 'fix the tool' })).id;
        yield* graph.tasks.finish({ id: task });
        yield* graph.reflection.answer({ id: entry, byId: task });
        const late = yield* demo.refusal(graph.reflection.answer({ id: entry, commit: yield* landed(source, 'a later fix') }));
        expect(late.code).toBe('already-answered');
        expect(yield* graph.blockAnswers.answerOf(entry)).toEqual({ kind: 'block', id: task });
      }),
    ),
  );

  it.effect(
    'a wrong answer act and a partial discovered-from answer are withdrawn one by one, their block, edge and journal kept, and the entry answers again after',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { source, tagma, entry } = yield* filedAgainstRepo(demo);
          const { graph } = demo;
          const wrong = (yield* graph.blocks.create({ projectId: tagma.id, tags: ['task'], title: 'another fix' })).id;
          yield* graph.tasks.finish({ id: wrong });
          yield* graph.reflection.answer({ id: entry, byId: wrong });
          const partial = (yield* graph.blocks.create({
            projectId: tagma.id,
            tags: ['task'],
            title: 'half of it',
            edges: [{ kind: 'discovered-from', to: entry }],
          })).id;
          yield* graph.tasks.finish({ id: partial });
          const stranger = (yield* graph.blocks.create({ projectId: tagma.id, tags: ['idea'], title: 'unrelated' })).id;
          expect(yield* graph.blockAnswers.answerOf(entry)).toEqual({ kind: 'block', id: partial });
          yield* graph.reflection.unanswer({ id: entry, byId: partial });
          expect(yield* graph.blockAnswers.answerOf(entry)).toEqual({ kind: 'block', id: wrong });
          yield* graph.reflection.unanswer({ id: entry, byId: wrong });
          yield* graph.reflection.unanswer({ id: entry, byId: wrong });
          expect(yield* graph.blockAnswers.answerOf(entry)).toBeNull();
          expect((yield* filedReflections(undefined, 100)).rows.map((row) => row.id)).toContain(entry);
          const read = yield* graph.reading.show(entry, 0, true);
          expect(read.edgesIn.some((edge) => edge.kind === 'discovered-from' && edge.fromId === partial)).toBe(true);
          expect(
            (yield* graph.journal.events({ blockId: entry }))
              .filter((row) => row.op === 'answer' || row.op === 'unanswer')
              .map((row) => [row.op, JSON.parse(row.payload)]),
          ).toEqual([
            ['unanswer', { by: wrong }],
            ['unanswer', { by: partial }],
            ['answer', { by: wrong }],
          ]);
          expect((yield* demo.refusal(graph.reflection.unanswer({ id: entry, byId: stranger }))).code).toBe('not-an-answer');
          const fix = yield* landed(source, 'the whole fix');
          yield* graph.reflection.answer({ id: entry, commit: fix });
          expect(yield* graph.blockAnswers.answerOf(entry)).toEqual({ kind: 'commit', sha: fix });
        }),
      ),
  );

  it.effect('a withdrawal names one answer, so its replay — concurrent or after a newer correct answer — withdraws nothing more', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { source, entry } = yield* filedAgainstRepo(demo);
        const { graph } = demo;
        const wrong = yield* said(source, ['rev-parse', 'HEAD']);
        const fix = yield* landed(source, 'the real fix');
        yield* graph.reflection.answer({ id: entry, commit: wrong });
        yield* Effect.all(
          [graph.reflection.unanswer({ id: entry, commit: wrong.slice(0, 10) }), graph.reflection.unanswer({ id: entry, commit: wrong })],
          { concurrency: 2 },
        );
        yield* graph.reflection.answer({ id: entry, commit: fix });
        yield* graph.reflection.unanswer({ id: entry, commit: wrong });
        expect((yield* demo.refusal(graph.reflection.answer({ id: entry, commit: wrong }))).code).toBe('already-answered');
        expect(yield* graph.blockAnswers.answerOf(entry)).toEqual({ kind: 'commit', sha: fix });
        expect((yield* graph.journal.events({ blockId: entry })).filter((row) => row.op === 'unanswer')).toHaveLength(1);
        expect((yield* demo.refusal(graph.reflection.unanswer({ id: entry, commit: 'deadbeef' }))).code).toBe('not-an-answer');
      }),
    ),
  );

  it.effect('a commit that proves no landed fix refuses and leaves the entry standing: another repository’s, and one no branch holds', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { source, entry } = yield* filedAgainstRepo(demo);
        const { graph } = demo;
        const elsewhere = yield* said(yield* tempRepoEffect(demo.fixture, 'foreign-'), ['rev-parse', 'HEAD']);
        const unlanded = yield* said(source, ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'never landed']);
        expect((yield* demo.refusal(graph.reflection.answer({ id: entry, commit: 'missing-fix' }))).code).toBe('commit-unknown');
        expect((yield* demo.refusal(graph.reflection.answer({ id: entry, commit: elsewhere }))).code).toBe('git-refused');
        expect((yield* demo.refusal(graph.reflection.answer({ id: entry, commit: unlanded }))).code).toBe('commit-unlanded');
        expect(yield* graph.blockAnswers.answerOf(entry)).toBeNull();
        expect((yield* filedReflections(undefined, 100)).rows.map((row) => row.id)).toContain(entry);
      }),
    ),
  );
});
