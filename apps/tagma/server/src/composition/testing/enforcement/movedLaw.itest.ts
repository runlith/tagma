import { expect } from 'bun:test';
import { dirname, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { TRIGGERS } from '../../../graph/testing/triggers.js';
import { BlockNames } from '../../../graph/contract/service/acts.js';
import { Blocks } from '../../../graph/contract/service/blocks.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { makeThreadDoors, type Outcome } from '../threadDoors.js';
import { suiteGit } from '../suiteGit.js';
import { LAYERED, LAYERED_KEY } from '../../../enforcement/testing/layered.js';

const TOOLS = ['create_block', 'set_module', 'update_block', 'read_block', 'read_enforcement'];

class Moving extends Context.Service<
  Moving,
  { readonly from: number; readonly to: number; readonly toRoot: string; readonly third: number }
>()('testing/MovedLaw') {}

const wrote = Effect.fnUntraced(function* (at: string, path: string, text: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.makeDirectory(dirname(join(at, path)), { recursive: true });
  yield* files.writeFileString(join(at, path), text);
});

const config = (inspections: object) => `export default ${JSON.stringify({ inspections })};\n`;

const answered = (outcome: Outcome): Record<string, unknown> => {
  expect(outcome.class, outcome.class === 'refusal' ? `refused ${outcome.code}: ${outcome.unblock.join('; ')}` : '').toBe('answer');
  return (outcome.class === 'answer' ? outcome.value : {}) as Record<string, unknown>;
};

const named = (outcome: Outcome): string => (answered(outcome).block as { name: string }).name;

const project = Effect.fnUntraced(function* (name: string, files: Readonly<Record<string, string>>) {
  const world = yield* DoorFixture;
  const root = yield* (yield* FileSystem.FileSystem).realPath(yield* world.directory(name));
  yield* suiteGit(root, 'init', '-q', '-b', 'main');
  for (const [path, text] of Object.entries(files)) yield* wrote(root, path, text);
  yield* suiteGit(root, 'add', '-A');
  yield* suiteGit(root, 'commit', '-q', '-m', 'seed');
  const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'stealth' });
  return { id: (added.body as { project: { id: number } }).project.id, root };
});

const setup = Effect.gen(function* () {
  const from = yield* project('moving-from', {
    'src/core/model.ts': 'export const model = 1;\n',
    'extra/tool.ts': 'export const tool = 1;\n',
    'lib/util.ts': 'export const util = 1;\n',
    'tagma.config.ts': config({ [LAYERED_KEY]: LAYERED }),
  });
  const to = yield* project('moving-to', { 'tagma.config.ts': config({}) });
  const third = yield* project('pointing', { 'notes.md': 'notes\n' });
  yield* projectLeaving(yield* DoorFixture, from.id, to.id, third.id);
  return { from: from.id, to: to.id, toRoot: to.root, third: third.id };
});

const fixture = doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer));

layer(Layer.effect(Moving, setup).pipe(Layer.provideMerge(fixture)), { excludeTestServices: true })('moved law', (it) => {
  it.effect('module cards with an enforced rule move only once the new project declares the inspection and its map holds', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const { from, to, toRoot, third } = yield* Moving;
      const doors = makeThreadDoors(world, from, TOOLS);
      const born = yield* world.op('create_thread', {}, `project=${from}`);
      const thread = (born.body as { snapshot: { thread: { id: string; ownerId: string } } }).snapshot.thread;
      const at = yield* doors.doorsFor(thread.id, thread.ownerId);

      const shelf = named(yield* doors.atNative('create_block', { title: 'Shelf' }, at));
      const drawn = answered(
        yield* doors.atNative(
          'set_module',
          {
            modules: [
              { id: 'lib', title: 'Lib', root: 'lib' },
              { id: 'app', title: 'The app', root: 'src', parent: shelf },
              { id: 'extra', title: 'Extra', root: 'extra', parent: shelf, entries: { replace: [{ at: '.', for: ['lib'] }] } },
            ],
          },
          at,
        ),
      );
      const card = (drawn.modules as readonly { id: string; card: string }[]).find((one) => one.id === 'app')?.card ?? '';
      const rule = named(yield* doors.atNative('create_block', { tags: ['rule'], title: 'Import only downward', parentId: card }, at));
      const served = yield* world.runtime.pool.resolve({ projectId: from });
      yield* Effect.provide(
        Effect.gen(function* () {
          yield* (yield* Blocks).setEnforcement({
            id: yield* (yield* BlockNames).idOfName(rule),
            anchors: [],
            stood: undefined,
            document: { strictness: 'gate', on: TRIGGERS.landing, inspection: LAYERED_KEY, debt: [], escaped: [] },
            journal: {},
          });
        }),
        served.context,
      );
      named(
        yield* doors.atNative(
          'create_block',
          { project: third, tags: ['idea'], title: 'Points at the law', edges: [{ kind: 'relates', to: rule }] },
          at,
        ),
      );
      const landing = named(yield* doors.atNative('create_block', { project: to, title: 'Landing' }, at));

      expect(yield* doors.atNative('update_block', { blockId: shelf, parentId: landing }, at)).toMatchObject({
        class: 'refusal',
        code: 'inspection-unknown',
      });
      yield* wrote(toRoot, 'tagma.config.ts', config({ [LAYERED_KEY]: LAYERED }));
      yield* suiteGit(toRoot, 'commit', '-qam', 'declare the inspection');
      expect(yield* doors.atNative('update_block', { blockId: shelf, parentId: landing }, at)).toMatchObject({
        class: 'refusal',
        code: 'module-map-invalid',
      });

      expect(answered(yield* doors.atNative('update_block', { blockId: card, parentId: landing }, at))).toMatchObject({
        block: { name: card },
        moved: { blocks: 2, relinked: 1 },
      });
      expect(answered(yield* doors.atNative('read_block', { blockIds: [card, rule, shelf] }, at)).reads).toMatchObject([
        { name: card, projectId: to },
        { name: rule, projectId: to, fields: { enforcement: { strictness: 'gate', inspection: LAYERED_KEY } } },
        { name: shelf, projectId: from },
      ]);
      expect(answered(yield* doors.atNative('read_enforcement', { project: to }, at)).counts).toMatchObject({ enforced: 1, gate: 1 });
      expect(answered(yield* doors.atNative('read_enforcement', { project: from }, at)).counts).toMatchObject({ enforced: 0 });
    }),
  );
});
