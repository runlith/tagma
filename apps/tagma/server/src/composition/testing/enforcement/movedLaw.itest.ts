import { expect } from 'bun:test';
import { dirname, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { ToolAnswer, toolExecute, toolPrepare } from '@runlith/agent/tool';
import { unthreadedCaller } from '../callers.js';
import { TRIGGERS } from '../../../graph/testing/triggers.js';
import { BlockNames } from '../../../graph/contract/service/acts.js';
import { Blocks } from '../../../graph/contract/service/blocks.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { makeThreadDoors, type Doors, type Outcome } from '../threadDoors.js';
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

const native = Effect.fnUntraced(function* (at: Doors, id: string, input: Record<string, unknown>, key: string) {
  const tool = at.native[id]!;
  const call = { toolCallId: key, caller: unthreadedCaller, messages: [] };
  const prepared = yield* toolPrepare(tool)!(input, call);
  const result = yield* toolExecute(tool)!(input, { ...call, prepared: prepared?.prepared });
  return JSON.parse(JSON.stringify(result instanceof ToolAnswer ? result.value : result)) as Record<string, unknown>;
});

const topOf = Effect.fnUntraced(function* (project: number) {
  const world = yield* DoorFixture;
  const roots = yield* world.op('list_root_blocks', {}, `project=${project}`);
  return (roots.body as { blocks: { name: string }[] }).blocks[0]!.name;
});

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

      const fromTop = yield* topOf(from);
      const shelf = named(yield* doors.atNative('create_block', { title: 'Shelf', parentId: fromTop }, at));
      const drawn = answered(
        yield* doors.atNative(
          'set_module',
          {
            modules: [
              { id: 'lib', title: 'Lib', root: 'lib', parent: fromTop },
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
          {
            project: third,
            parentId: yield* topOf(third),
            tags: ['idea'],
            title: 'Points at the law',
            edges: [{ kind: 'relates', to: rule }],
          },
          at,
        ),
      );
      const landing = named(yield* doors.atNative('create_block', { project: to, title: 'Landing', parentId: yield* topOf(to) }, at));
      const ordinary = yield* native(
        at,
        'create_block',
        { title: 'Stays at the source', parentId: fromTop, edges: [{ kind: 'relates', to: card }] },
        'signed-create',
      );
      const witness = (ordinary.block as { name: string }).name;
      const created = (yield* world.op('read_events', { project: from, limit: 2 })).body as {
        events: { id: number; op: string; blockName: string }[];
      };
      expect(created.events).toMatchObject([
        { op: 'link', blockName: witness },
        { op: 'create', blockName: witness },
      ]);
      expect(ordinary.journal).toEqual({ from: created.events[1]!.id - 1, to: created.events[0]!.id });

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

      const destination = yield* world.runtime.pool.resolve({ projectId: to });
      const source = yield* world.runtime.pool.resolve({ projectId: from });
      const result = yield* native(at, 'update_block', { blockId: card, parentId: landing }, 'signed-move');
      const events = (yield* world.op('read_events', { project: from, limit: 3 })).body as {
        events: { id: number; op: string; blockName: string }[];
      };
      expect(events.events).toMatchObject([
        { op: 'depart', blockName: card },
        { op: 'link', blockName: witness },
        { op: 'unlink', blockName: witness },
      ]);
      const departure = events.events[0]!;
      const history = (yield* world.op('read_journal', { project: from, limit: 2 })).body as {
        batches: { blockName: string; moved?: { name: string } }[];
      };
      const departed = history.batches.find((batch) => batch.moved?.name === card)!.blockName;
      expect(result.journalUnreadable).toBeUndefined();
      const subjectName = (result.journal as { subject: { name: string } }).subject.name;
      expect(subjectName.endsWith(departed)).toBe(true);
      expect(result).toMatchObject({
        block: { name: card },
        graphCopy: { projectId: to, checkout: destination.checkout, tree: destination.layout.treeRoot, branch: null },
        moved: { blocks: 2, relinked: 1 },
        journal: {
          from: departure.id - 1,
          to: departure.id,
          subject: {
            name: subjectName,
            copy: { projectId: from, checkout: source.checkout, tree: source.layout.treeRoot, branch: null },
          },
        },
      });
      const sourceNames = Context.get(source.context, BlockNames);
      const sourceUuid = yield* sourceNames.uuidOf(yield* sourceNames.idOfName(subjectName));
      if (sourceUuid === null) return yield* Effect.die('the departure has no source identity');
      expect(subjectName).toBe(sourceUuid.replaceAll('-', ''));
      const targetBlocks = Context.get(destination.context, Blocks);
      const collision = yield* targetBlocks.create({
        projectId: to,
        parentId: (yield* targetBlocks.rootBlockOf(to)).id,
        title: 'A foreign block with the same short name',
        uuid: (sourceUuid[0] === '0' ? '1' : '0') + sourceUuid.slice(1),
      });
      expect(collision.uuid.replaceAll('-', '').slice(-8)).toBe(sourceUuid.replaceAll('-', '').slice(-8));
      expect(yield* doors.atNative('read_block', { project: from, blockIds: [subjectName] }, at)).toMatchObject({
        class: 'refusal',
        code: 'deleted',
      });
      expect(
        yield* world.op('read_block_diff', { project: from, blockId: subjectName, from: departure.id - 1, to: departure.id }),
      ).toMatchObject({ status: 200, body: { diff: { ops: ['depart'], changes: [{ kind: 'move' }] } } });
      expect(answered(yield* doors.atNative('read_block', { blockIds: [card, rule, shelf] }, at)).reads).toMatchObject([
        { name: card, projectId: to },
        { name: rule, projectId: to, fields: { enforcement: { strictness: 'gate', inspection: LAYERED_KEY } } },
        { name: shelf, projectId: from },
      ]);
      expect(answered(yield* doors.atNative('read_enforcement', { project: to }, at)).counts).toMatchObject({ enforced: 1, gate: 1 });
      expect(answered(yield* doors.atNative('read_enforcement', { project: from }, at)).counts).toMatchObject({ enforced: 0 });
    }),
  );

  it.effect('a resumed move answers with the destination copy from the source thread', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const { from, to } = yield* Moving;
      const doors = makeThreadDoors(world, from, TOOLS);
      const born = yield* world.op('create_thread', {}, `project=${from}`);
      const thread = (born.body as { snapshot: { thread: { id: string; ownerId: string } } }).snapshot.thread;
      const at = yield* doors.doorsFor(thread.id, thread.ownerId);
      const name = named(yield* doors.atNative('create_block', { title: 'Interrupted move', parentId: yield* topOf(from) }, at));
      const source = yield* world.runtime.pool.resolve({ projectId: from });
      const destination = yield* world.runtime.pool.resolve({ projectId: to });
      const sourceBlocks = Context.get(source.context, Blocks);
      const targetBlocks = Context.get(destination.context, Blocks);
      const row = yield* sourceBlocks.blockById(yield* Context.get(source.context, BlockNames).idOfName(name));
      const sourceRoot = yield* sourceBlocks.rootBlockOf(from);
      const targetRoot = yield* targetBlocks.rootBlockOf(to);
      yield* targetBlocks.arrive({
        projectId: to,
        parentId: targetRoot.id,
        from: sourceRoot.uuid,
        blocks: [
          {
            uuid: row.uuid,
            parent: null,
            ord: row.ord,
            title: row.title,
            body: row.body,
            tags: row.tags,
            fields: row.fields,
            sessions: [],
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            sources: [],
            links: [],
            far: [],
          },
        ],
      });
      const target = yield* topOf(to);
      const result = yield* native(at, 'update_block', { blockId: `${from}/${name}`, parentId: target }, 'signed-resumed-move');
      const events = (yield* world.op('read_events', { project: from, limit: 1 })).body as {
        events: { id: number; op: string; blockName: string }[];
      };
      expect(events.events).toMatchObject([{ op: 'depart', blockName: name }]);
      const departure = events.events[0]!;
      const history = (yield* world.op('read_journal', { project: from, limit: 1 })).body as {
        batches: { blockName: string; moved?: { name: string } }[];
      };
      const departed = history.batches.find((batch) => batch.moved?.name === name)!.blockName;
      expect(result.journalUnreadable).toBeUndefined();
      const subjectName = (result.journal as { subject: { name: string } }).subject.name;
      expect(subjectName.endsWith(departed)).toBe(true);
      expect(result).toMatchObject({
        block: { name },
        graphCopy: { projectId: to, checkout: destination.checkout, tree: destination.layout.treeRoot, branch: null },
        moved: { blocks: 1 },
        journal: {
          from: departure.id - 1,
          to: departure.id,
          subject: {
            name: subjectName,
            copy: { projectId: from, checkout: source.checkout, tree: source.layout.treeRoot, branch: null },
          },
        },
      });
      expect(
        yield* world.op('read_block_diff', { project: from, blockId: subjectName, from: departure.id - 1, to: departure.id }),
      ).toMatchObject({ status: 200, body: { diff: { ops: ['depart'], changes: [{ kind: 'move' }] } } });
      expect(answered(yield* doors.atNative('read_block', { project: to, blockIds: [name] }, at)).reads).toMatchObject([
        { name, projectId: to, parentName: target },
      ]);

      const sourceNames = Context.get(source.context, BlockNames);
      const departedUuid = yield* sourceNames.uuidOf(yield* sourceNames.idOfName(subjectName));
      if (departedUuid === null) return yield* Effect.die('the source trash block has no identity');
      const split = departedUuid.length - 12;
      const twinUuid = departedUuid.slice(0, split) + (departedUuid[split] === '0' ? '1' : '0') + departedUuid.slice(split + 1);
      const twin = yield* sourceBlocks.create({
        projectId: from,
        parentId: sourceRoot.id,
        title: 'A local block with the same short name',
        uuid: twinUuid,
      });
      const twinIdentity = twin.uuid.replaceAll('-', '');
      expect(twinIdentity.slice(-8)).toBe(subjectName.slice(-8));
      const trash = (yield* world.op('list_trash', { project: from })).body as { blocks: { name: string; identity?: string }[] };
      expect(trash.blocks).toContainEqual(expect.objectContaining({ name: subjectName.slice(-8), identity: subjectName }));
      expect(yield* world.op('list_trash', { project: from, name: subjectName.slice(-12) })).toMatchObject({
        status: 200,
        body: { blocks: [{ identity: subjectName }] },
      });
      expect(yield* world.op('list_trash', { project: from, name: subjectName.slice(-8) })).toMatchObject({
        status: 409,
        body: { code: 'ambiguous-name' },
      });
      expect(yield* world.op('restore_block', { project: from, blockId: subjectName })).toMatchObject({ status: 200 });
      const tree = (yield* world.op('read_tree', { project: from })).body as {
        blocks: { name: string; identity?: string; parentIdentity?: string | null }[];
      };
      expect(tree.blocks.filter((block) => block.name === subjectName.slice(-8))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ identity: subjectName, parentIdentity: sourceRoot.uuid.replaceAll('-', '') }),
          expect.objectContaining({ identity: twinIdentity, parentIdentity: sourceRoot.uuid.replaceAll('-', '') }),
        ]),
      );
      expect(
        yield* world.op('update_block', { project: from, blockId: subjectName, title: 'Restored source', body: `[[${twinIdentity}]]` }),
      ).toMatchObject({ status: 200 });
      expect(yield* world.op('link_blocks', { project: from, fromId: subjectName, kind: 'relates', toId: twinIdentity })).toMatchObject({
        status: 200,
      });
      expect(yield* world.op('read_block', { project: from, blockIds: [subjectName.slice(-12)] })).toMatchObject({
        status: 200,
        body: { reads: [{ identity: subjectName, title: 'Restored source' }] },
      });
      expect(yield* world.op('read_block', { project: from, blockIds: [subjectName.slice(-8)] })).toMatchObject({
        status: 409,
        body: { code: 'ambiguous-name' },
      });
      expect(yield* world.op('read_edges', { project: from })).toMatchObject({
        status: 200,
        body: { edges: expect.arrayContaining([expect.objectContaining({ fromIdentity: subjectName, toIdentity: twinIdentity })]) },
      });
      expect(yield* world.op('read_refs', { project: from })).toMatchObject({
        status: 200,
        body: { refs: expect.arrayContaining([expect.objectContaining({ fromIdentity: subjectName, toIdentity: twinIdentity })]) },
      });
      expect(yield* world.op('read_block', { project: from, blockIds: [subjectName, twinIdentity] })).toMatchObject({
        status: 200,
        body: {
          reads: [
            {
              name: subjectName.slice(-8),
              identity: subjectName,
              title: 'Restored source',
              refsOutDetails: [{ name: twinIdentity.slice(-8), identity: twinIdentity }],
            },
            {
              name: twinIdentity.slice(-8),
              identity: twinIdentity,
              title: 'A local block with the same short name',
              refsInDetails: [{ name: subjectName.slice(-8), identity: subjectName }],
            },
          ],
        },
      });
      expect(yield* world.op('read_titles', { project: from, names: [subjectName, twinIdentity] })).toMatchObject({
        status: 200,
        body: {
          titles: [
            { name: subjectName, identity: subjectName, rowKey: expect.any(Number) },
            { name: twinIdentity, identity: twinIdentity, rowKey: expect.any(Number) },
          ],
        },
      });
      const partial = subjectName.slice(-12);
      expect(yield* world.op('read_titles', { project: from, names: [partial] })).toMatchObject({
        status: 200,
        body: { titles: [{ name: partial, shortName: subjectName.slice(-8), identity: subjectName }] },
      });
      const collisionUuid = (departedUuid[0] === '0' ? '1' : '0') + departedUuid.slice(1);
      yield* sourceBlocks.create({ projectId: from, parentId: sourceRoot.id, uuid: collisionUuid, title: 'A newly colliding block' });
      expect(yield* world.op('read_titles', { project: from, names: [partial] })).toMatchObject({
        status: 409,
        body: { code: 'ambiguous-name' },
      });
      const batch = yield* world.op('apply_batch', {
        project: from,
        ops: [{ op: 'create', $id: 'child', parentId: subjectName, title: 'Child of restored source' }],
      });
      expect(batch.status).toBe(200);
      const identity = (batch.body as { identities: { child: string } }).identities.child;
      expect(identity).toHaveLength(32);
      expect(yield* world.op('read_block', { project: from, blockIds: [identity] })).toMatchObject({
        status: 200,
        body: { reads: [{ identity, parentIdentity: subjectName }] },
      });
    }),
  );
});
