import { expect } from 'bun:test';
import { dirname, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { TRIGGERS } from '../../../graph/testing/triggers.js';
import { RuleChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import type { CoveredRepositoriesAnswer } from '../../../workspace/contract/wire/repositories.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { makeThreadDoors, type Doors, type Outcome } from '../threadDoors.js';
import { suiteGit } from '../suiteGit.js';
import { LAYERED, LAYERED_KEY } from '../../../enforcement/testing/layered.js';

const READS = ['read_enforcement', 'read_inspections', 'check_rules', 'create_block', 'enforce_rule', 'set_module'];

const LAYERS = { modules: [{ id: 'app', title: 'The app', root: 'src', order: [['core/'], ['ui/']] }] };

class Copied extends Context.Service<Copied, { readonly project: number; readonly root: string }>()('testing/CopiedLaw') {}

const wrote = Effect.fnUntraced(function* (at: string, path: string, text: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.makeDirectory(dirname(join(at, path)), { recursive: true });
  yield* files.writeFileString(join(at, path), text);
});

const answered = (outcome: Outcome): Record<string, unknown> => {
  expect(outcome.class, outcome.class === 'refusal' ? `refused ${outcome.code}: ${outcome.unblock.join('; ')}` : '').toBe('answer');
  return (outcome.class === 'answer' ? outcome.value : {}) as Record<string, unknown>;
};

const gated = Effect.fnUntraced(function* (at: string, path: string) {
  const world = yield* DoorFixture;
  const { project } = yield* Copied;
  yield* wrote(at, path, "import { panel } from '../ui/panel';\nexport const upward = panel;\n");
  yield* suiteGit(at, 'add', '-A');
  yield* suiteGit(at, 'commit', '-q', '-m', `an upward import in ${path}`);
  const judged = yield* Context.get(world.runtime.enforcement, RuleChecks).before('submit_work', {
    kind: 'tree',
    projectId: project,
    root: at,
    base: yield* suiteGit(at, 'rev-parse', 'HEAD~1'),
    built: yield* suiteGit(at, 'rev-parse', 'HEAD^{tree}'),
    paths: [path],
  });
  expect(judged.refused?.code).toBe('rule-violated');
  return new Set((judged.crossed ?? []).map((one) => one.rule));
});

const readers = Effect.fnUntraced(function* (doors: ReturnType<typeof makeThreadDoors>, at: Doors) {
  const law = answered(yield* doors.atNative('read_enforcement', {}, at));
  const measured = (law.rules as { rows: readonly { rule: string; strictness: string | null }[] }).rows
    .filter((one) => one.strictness !== null)
    .map((one) => one.rule);
  expect(law.counts).toMatchObject({ enforced: measured.length, gate: measured.length });
  const checked = answered(yield* doors.atNative('check_rules', { over: 'all', rules: measured }, at));
  expect((checked.rules as readonly { rule: string }[]).map((one) => one.rule).toSorted()).toEqual(measured.toSorted());
  return new Set(measured);
});

const threadIn = Effect.fnUntraced(function* (doors: ReturnType<typeof makeThreadDoors>) {
  const world = yield* DoorFixture;
  const { project } = yield* Copied;
  const born = yield* world.op('create_thread', {}, `project=${project}`);
  const thread = (born.body as { snapshot: { thread: { id: string; ownerId: string } } }).snapshot.thread;
  return { thread, doors: yield* doors.doorsFor(thread.id, thread.ownerId) };
});

const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const files = yield* FileSystem.FileSystem;
  const root = yield* files.realPath(yield* world.directory('copied'));
  yield* suiteGit(root, 'init', '-q', '-b', 'main');
  yield* wrote(root, 'src/core/model.ts', 'export const model = 1;\n');
  yield* wrote(root, 'src/ui/panel.ts', "import { model } from '../core/model';\nexport const panel = model;\n");
  yield* wrote(root, 'tagma.config.ts', `export default ${JSON.stringify({ inspections: { [LAYERED_KEY]: LAYERED } })};\n`);
  yield* suiteGit(root, 'add', '-A');
  yield* suiteGit(root, 'commit', '-q', '-m', 'seed');
  const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'stealth' });
  return { project: (added.body as { project: { id: number } }).project.id, root };
});

const fixture = doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer));

layer(Layer.effect(Copied, setup).pipe(Layer.provideMerge(fixture)), {
  excludeTestServices: true,
})('copied law', (it) => {
  it.effect('a thread on the main checkout reads the same enforced rules its landing gate judges', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const { project, root } = yield* Copied;
      const doors = makeThreadDoors(world, project, READS);
      const { doors: placed } = yield* threadIn(doors);
      const created = answered(yield* doors.atNative('create_block', { tags: ['rule'], title: 'Import only downward' }, placed));
      const rule = (created.block as { name: string }).name;
      answered(yield* doors.atNative('set_module', LAYERS, placed));
      answered(
        yield* doors.atNative(
          'enforce_rule',
          { blockId: rule, base: null, strictness: 'gate', on: TRIGGERS.landing, inspection: LAYERED_KEY },
          placed,
        ),
      );

      const read = yield* readers(doors, placed);
      expect(read).toEqual(new Set([rule]));
      expect(yield* gated(root, 'src/core/view.ts')).toEqual(read);
    }),
  );

  it.effect('a thread in a worktree reads the same enforced rules the gate judges in that worktree', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const { project } = yield* Copied;
      yield* Context.get(world.runtime.workspace, Coverage).cover(project);
      const listed = (yield* world.op('read_repositories', {}, `project=${project}`)).body as CoveredRepositoriesAnswer;
      const repository = listed.repositories[0]?.binding;
      expect(repository, `project ${project} covers no store`).toBeDefined();
      const destination = join(yield* files.realPath(yield* world.directory('worktrees')), 'placed');
      const operationId = world.uniqueName();
      yield* world.op(
        'prepare_worktree',
        { operationId, repository, destination, mode: { kind: 'new-branch', branch: 'placed', start: 'HEAD' } },
        `project=${project}`,
      );
      const worktree = yield* world.op('create_worktree', { operationId }, `project=${project}`);
      yield* wrote(destination, 'src/core/view.ts', "import { panel } from '../ui/panel';\nexport const view = panel;\n");
      yield* suiteGit(destination, 'add', '-A');
      yield* suiteGit(destination, 'commit', '-qm', 'seed the debt on the branch');
      const doors = makeThreadDoors(world, project, READS);
      const { thread } = yield* threadIn(doors);
      const rootId = (worktree.body as { operation: { rootId: string } }).operation.rootId;
      expect((yield* world.op('move_thread', { threadId: thread.id, worktree: rootId }, `project=${project}`)).body).toMatchObject({
        status: 'selected',
      });
      const placed = yield* doors.doorsFor(thread.id, thread.ownerId);
      expect(placed.root).toBe(destination);
      const created = answered(yield* doors.atNative('create_block', { tags: ['rule'], title: 'Import only downward here' }, placed));
      const rule = (created.block as { name: string }).name;
      const owner = (
        answered(yield* doors.atNative('create_block', { tags: ['task'], title: 'Move the view off the panel' }, placed)).block as {
          name: string;
        }
      ).name;
      answered(yield* doors.atNative('set_module', LAYERS, placed));
      expect(
        yield* doors.atNative('enforce_rule', { blockId: rule, base: null, strictness: 'gate', inspection: LAYERED_KEY }, placed),
      ).toMatchObject({ class: 'refusal', code: 'not-found' });
      answered(
        yield* doors.atNative(
          'enforce_rule',
          {
            checkout: destination,
            blockId: rule,
            base: null,
            strictness: 'gate',
            on: TRIGGERS.landing,
            inspection: LAYERED_KEY,
            owners: { 'app order core/view.ts -> ui/': owner },
          },
          placed,
        ),
      );

      const read = yield* readers(doors, placed);
      expect(read.has(rule)).toBe(true);
      expect(yield* gated(destination, 'src/core/other.ts')).toEqual(read);
    }),
  );
});
