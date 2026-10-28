import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Effect, FileSystem, Layer } from 'effect';
import { eq } from 'drizzle-orm';
import { join } from 'node:path';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../composition/testing/graphFixture.js';
import { spokenId } from '../../platform/contract/wire/ids.js';
import { block } from '../store/tables.js';
import { decodeBlockFile, encodeBlockFile } from './blockFile.js';
import { treeLedger } from './ledger.js';
import { projectDelta, projectToTree, restorePaths } from './projection.js';

const withTree = <A, E, R>(body: (demo: EffectDemo, treeRoot: string) => Effect.Effect<A, E, R>) =>
  withDemo((demo) =>
    Effect.gen(function* () {
      const treeRoot = yield* demo.fixture.directory('tree');
      yield* projectToTree({ projectId: demo.projectId, treeRoot });
      return yield* body(demo, treeRoot);
    }),
  );

const fileAt = (treeRoot: string, path: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => Effect.flatMap(fs.readFileString(join(treeRoot, path)), decodeBlockFile));

layer(demoGraphLayer().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('delta projection matrix', (it) => {
  it.effect('projects unplaced ancestors, empty slugs and collisions, then collapses the last-child directory', () =>
    withTree((demo, treeRoot) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const fs = yield* FileSystem.FileSystem;
        const one = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'One' });
        const two = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Two', parentId: one.id, body: 'kept parent' });
        const three = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Three', parentId: two.id, body: 'deep body' });
        const empty = yield* graph.blocks.create({ projectId, tags: ['idea'], title: '###' });
        const a = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Same Name' });
        const b = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Same Name' });
        yield* projectDelta({ projectId, treeRoot, blockIds: [one.id, two.id, three.id, empty.id, a.id, b.id] });
        const paths = [
          'demo/one/index.md',
          'demo/one/two/index.md',
          'demo/one/two/three.md',
          `demo/${spokenId(empty.uuid)}.md`,
          'demo/same-name.md',
          `demo/same-name-${spokenId(b.uuid)}.md`,
        ];
        const files = yield* Effect.forEach(paths, (path) => fileAt(treeRoot, path));
        expect(files.map((file) => [file.frontmatter.id, file.body])).toEqual([
          [one.uuid, ''],
          [two.uuid, 'kept parent'],
          [three.uuid, 'deep body'],
          [empty.uuid, ''],
          [a.uuid, ''],
          [b.uuid, ''],
        ]);
        expect((yield* graph.blocks.blockById(three.id)).path).toBe('demo/one/two/three.md');
        yield* graph.trash.delete({ id: three.id });
        yield* projectDelta({ projectId, treeRoot, blockIds: [three.id, two.id] });
        const collapsed = yield* fileAt(treeRoot, 'demo/one/two.md');
        expect([collapsed.frontmatter.id, collapsed.body]).toEqual([two.uuid, 'kept parent']);
        expect(yield* fs.exists(join(treeRoot, 'demo/one/two'))).toBe(false);
      }),
    ),
  );

  it.effect('hands bare leaf and directory names to siblings without overwriting either identity or descendant', () =>
    withTree((demo, treeRoot) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const leafHeir = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Shared Leaf', body: 'leaf heir' });
        const leafHolder = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Shared Leaf', body: 'leaf holder' });
        const hallHeir = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Shared Hall', body: 'hall heir' });
        const hallHolder = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Shared Hall', body: 'hall holder' });
        const holderKid = yield* graph.blocks.create({
          projectId,
          tags: ['idea'],
          title: 'Kept',
          parentId: hallHolder.id,
          body: 'holder kid',
        });
        const heirKid = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Kept', parentId: hallHeir.id, body: 'heir kid' });
        yield* graph.blocks.update({ id: leafHolder.id, ord: -2 });
        yield* graph.blocks.update({ id: hallHolder.id, ord: -1 });
        const all = [leafHolder, leafHeir, hallHolder, hallHeir, holderKid, heirKid];
        yield* projectDelta({ projectId, treeRoot, blockIds: all.map((one) => one.id) });
        expect([(yield* graph.blocks.blockById(leafHolder.id)).path, (yield* graph.blocks.blockById(hallHolder.id)).path]).toEqual([
          'demo/shared-leaf.md',
          'demo/shared-hall/index.md',
        ]);
        yield* graph.blocks.update({ id: leafHolder.id, title: 'Renamed Leaf' });
        yield* graph.blocks.update({ id: hallHolder.id, title: 'Renamed Hall' });
        yield* projectDelta({ projectId, treeRoot, blockIds: [leafHolder.id, hallHolder.id] });
        const paths = [
          'demo/renamed-leaf.md',
          'demo/shared-leaf.md',
          'demo/renamed-hall/index.md',
          'demo/shared-hall/index.md',
          'demo/renamed-hall/kept.md',
          'demo/shared-hall/kept.md',
        ];
        for (const [index, one] of all.entries()) {
          const path = paths[index]!;
          expect((yield* graph.blocks.blockById(one.id)).path).toBe(path);
          const file = yield* fileAt(treeRoot, path);
          expect([file.frontmatter.id, file.body]).toEqual([one.uuid, one.body]);
        }
        const fs = yield* FileSystem.FileSystem;
        const names = yield* fs.readDirectory(treeRoot, { recursive: true });
        const files = yield* Effect.forEach(
          names.filter((name) => name.endsWith('.md')),
          (name) => fileAt(treeRoot, name),
        );
        expect(new Set(files.map((file) => file.frontmatter.id)).size).toBe(files.length);
      }),
    ),
  );

  it.effect('a retitle onto the place of a block re-parented in the same act lands both', () =>
    withTree((demo, treeRoot) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const before = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Old Shelf' });
        const after = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'New Shelf' });
        const stayer = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Stayer', parentId: before.id, body: 'stays' });
        const leaver = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Leaver', parentId: before.id, body: 'leaves' });
        yield* projectDelta({ projectId, treeRoot, blockIds: [before.id, after.id, stayer.id, leaver.id] });
        yield* graph.blocks.update({ id: stayer.id, title: 'Leaver' });
        yield* graph.blocks.update({ id: leaver.id, parentId: after.id });
        yield* projectDelta({ projectId, treeRoot, blockIds: [stayer.id, leaver.id] });
        for (const [one, path] of [
          [stayer, 'demo/old-shelf/leaver.md'],
          [leaver, 'demo/new-shelf/leaver.md'],
        ] as const) {
          expect((yield* graph.blocks.blockById(one.id)).path).toBe(path);
          const file = yield* fileAt(treeRoot, path);
          expect([file.frontmatter.id, file.body]).toEqual([one.uuid, one.body]);
        }
      }),
    ),
  );

  it.effect('collapsing the emptied directory preserves a moved child and its grandchild', () =>
    withTree((demo, treeRoot) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const emptied = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Emptied', body: 'emptied' });
        const receiver = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Receiver' });
        const middle = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Middle', parentId: emptied.id, body: 'middle' });
        const deep = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Deep', parentId: middle.id, body: 'deep body' });
        yield* projectDelta({ projectId, treeRoot, blockIds: [emptied.id, receiver.id, middle.id, deep.id] });
        yield* graph.blocks.update({ id: middle.id, parentId: receiver.id });
        yield* projectDelta({ projectId, treeRoot, blockIds: [emptied.id, middle.id] });
        for (const [one, path] of [
          [emptied, 'demo/emptied.md'],
          [middle, 'demo/receiver/middle/index.md'],
          [deep, 'demo/receiver/middle/deep.md'],
        ] as const) {
          expect((yield* graph.blocks.blockById(one.id)).path).toBe(path);
          const file = yield* fileAt(treeRoot, path);
          expect([file.frontmatter.id, file.body]).toEqual([one.uuid, one.body]);
        }
      }),
    ),
  );

  it.effect('renames a directory while evacuating a child subtree to the root in the same act', () =>
    withTree((demo, treeRoot) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const outer = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Outer Old' });
        const leaving = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Leaving', parentId: outer.id, body: 'leaving' });
        const staying = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Staying', parentId: outer.id, body: 'staying' });
        const carried = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Carried', parentId: leaving.id, body: 'carried' });
        yield* projectDelta({ projectId, treeRoot, blockIds: [outer.id, leaving.id, staying.id, carried.id] });
        yield* graph.blocks.update({ id: outer.id, title: 'Outer New' });
        yield* graph.blocks.update({ id: leaving.id, parentId: (yield* graph.blocks.rootBlockOf(projectId)).id });
        yield* projectDelta({ projectId, treeRoot, blockIds: [outer.id, leaving.id] });
        for (const [one, path] of [
          [staying, 'demo/outer-new/staying.md'],
          [leaving, 'demo/leaving/index.md'],
          [carried, 'demo/leaving/carried.md'],
        ] as const) {
          expect((yield* graph.blocks.blockById(one.id)).path).toBe(path);
          const file = yield* fileAt(treeRoot, path);
          expect([file.frontmatter.id, file.body]).toEqual([one.uuid, one.body]);
        }
      }),
    ),
  );

  it.effect('refuses to overwrite a foreign file and undoes only changed paths beside an external edit', () =>
    withTree((demo, treeRoot) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const fs = yield* FileSystem.FileSystem;
        const shelf = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Undo Shelf' });
        const moving = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Mover Before', parentId: shelf.id, body: 'moving' });
        const beside = yield* graph.blocks.create({
          projectId,
          tags: ['idea'],
          title: 'Beside',
          parentId: shelf.id,
          body: 'as the graph holds it',
        });
        yield* projectDelta({ projectId, treeRoot, blockIds: [shelf.id, moving.id, beside.id] });
        const before = yield* fs.readFileString(join(treeRoot, 'demo/undo-shelf/mover-before.md'));
        const target = join(treeRoot, 'demo/undo-shelf/mover-after.md');
        yield* fs.writeFileString(target, 'not a block of this graph\n');
        yield* graph.blocks.update({ id: moving.id, title: 'Mover After' });
        const refused = yield* Effect.result(projectDelta({ projectId, treeRoot, blockIds: [moving.id] }));
        expect(refused).toMatchObject({ _tag: 'Failure', failure: { _tag: 'ExportFailed' } });
        expect(yield* fs.readFileString(target)).toBe('not a block of this graph\n');
        expect(yield* fs.readFileString(join(treeRoot, 'demo/undo-shelf/mover-before.md'))).toBe(before);
        yield* fs.remove(target);
        const restorable: string[] = [];
        const moved = yield* projectDelta({
          projectId,
          treeRoot,
          blockIds: [moving.id],
          touched: (path, _, restore) => {
            if (restore) restorable.push(path);
          },
        });
        expect(moved).toEqual({ written: 1, moved: 1, removed: 0 });
        const renamed = yield* fileAt(treeRoot, 'demo/undo-shelf/mover-after.md');
        expect([renamed.frontmatter.id, renamed.body]).toEqual([moving.uuid, 'moving']);
        const besidePath = join(treeRoot, 'demo/undo-shelf/beside.md');
        const original = yield* decodeBlockFile(yield* fs.readFileString(besidePath));
        const edited = encodeBlockFile({ ...original, body: 'edited outside, not yet read' });
        yield* fs.writeFileString(besidePath, edited);
        yield* graph.blocks.update({ id: moving.id, title: 'Mover Before' });
        yield* graph.graphStore.db.update(block).set({ path: 'demo/undo-shelf/mover-before.md' }).where(eq(block.id, moving.id));
        yield* restorePaths({ projectId, treeRoot, paths: restorable });
        expect(yield* fs.readFileString(besidePath)).toBe(edited);
        expect(yield* fs.readFileString(join(treeRoot, 'demo/undo-shelf/mover-before.md'))).toBe(before);
        expect(yield* fs.exists(target)).toBe(false);
      }),
    ),
  );

  it.effect('a directory name containing an underscore moves only its own subtree', () =>
    withTree((demo, treeRoot) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const fs = yield* FileSystem.FileSystem;
        const odd = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Hxll' });
        const oddChild = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Odd Child', parentId: odd.id, body: 'odd' });
        const plain = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Hall' });
        const plainChild = yield* graph.blocks.create({
          projectId,
          tags: ['idea'],
          title: 'Plain Child',
          parentId: plain.id,
          body: 'plain',
        });
        yield* projectDelta({ projectId, treeRoot, blockIds: [odd.id, oddChild.id, plain.id, plainChild.id] });
        const unchanged = yield* fs.readFileString(join(treeRoot, 'demo/hall/plain-child.md'));
        yield* fs.rename(join(treeRoot, 'demo/hxll'), join(treeRoot, 'demo/h_ll'));
        const { db } = graph.graphStore;
        yield* db.update(block).set({ path: 'demo/h_ll/index.md' }).where(eq(block.id, odd.id));
        yield* db.update(block).set({ path: 'demo/h_ll/odd-child.md' }).where(eq(block.id, oddChild.id));
        yield* graph.blocks.update({ id: odd.id, title: 'Odd Renamed' });
        yield* projectDelta({ projectId, treeRoot, blockIds: [odd.id] });
        expect((yield* graph.blocks.blockById(oddChild.id)).path).toBe('demo/odd-renamed/odd-child.md');
        const moved = yield* fileAt(treeRoot, 'demo/odd-renamed/odd-child.md');
        expect([moved.frontmatter.id, moved.body]).toEqual([oddChild.uuid, 'odd']);
        expect((yield* graph.blocks.blockById(plainChild.id)).path).toBe('demo/hall/plain-child.md');
        expect(yield* fs.readFileString(join(treeRoot, 'demo/hall/plain-child.md'))).toBe(unchanged);
      }),
    ),
  );

  it.effect('re-encodes body references, ord, sources and edges without a move, and writes nothing when unchanged', () =>
    withTree((demo, treeRoot) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const fs = yield* FileSystem.FileSystem;
        const target = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Cited' });
        const owner = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Owner', body: 'nothing yet' });
        yield* projectDelta({ projectId, treeRoot, blockIds: [target.id, owner.id] });
        const delta = () => projectDelta({ projectId, treeRoot, blockIds: [owner.id] });
        const body = `now cites [[${yield* demo.nameOf(target.id)}]]`;
        yield* graph.blocks.update({ id: owner.id, body });
        yield* delta();
        expect((yield* fileAt(treeRoot, 'demo/owner.md')).body).toBe(body);
        yield* graph.edges.link({ fromId: owner.id, toId: target.id, kind: 'relates' });
        yield* delta();
        expect((yield* fileAt(treeRoot, 'demo/owner.md')).frontmatter.edges).toEqual([{ kind: 'relates', to: target.uuid }]);
        yield* fs.writeFileString(join(demo.demoRoot, 'thing.ts'), 'export const thing = 1;\n');
        yield* graph.sources.attach({ blockId: owner.id, kind: 'file', ref: 'thing.ts' });
        yield* delta();
        expect((yield* fileAt(treeRoot, 'demo/owner.md')).frontmatter.sources).toMatchObject([{ kind: 'file', ref: 'thing.ts' }]);
        yield* graph.blocks.update({ id: owner.id, ord: 99.5 });
        expect(yield* delta()).toEqual({ written: 1, moved: 0, removed: 0 });
        expect((yield* graph.blocks.blockById(owner.id)).path).toBe('demo/owner.md');
        const ordered = yield* fileAt(treeRoot, 'demo/owner.md');
        expect([ordered.frontmatter.id, ordered.frontmatter.ord, ordered.body]).toEqual([owner.uuid, 99.5, body]);
        expect(yield* delta()).toEqual({ written: 0, moved: 0, removed: 0 });
      }),
    ),
  );

  it.effect('keeps an edge to a trashed subtree identical through delta, full projection and ledger comparison', () =>
    withTree((demo, treeRoot) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const fs = yield* FileSystem.FileSystem;
        const holder = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Holder' });
        const gone = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Trashed Target' });
        const child = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Memo', parentId: gone.id });
        yield* graph.edges.link({ fromId: holder.id, toId: gone.id, kind: 'relates' });
        yield* projectDelta({ projectId, treeRoot, blockIds: [holder.id, gone.id, child.id] });
        yield* graph.trash.delete({ id: gone.id });
        expect((yield* projectDelta({ projectId, treeRoot, blockIds: [holder.id, gone.id, child.id] })).removed).toBeGreaterThanOrEqual(1);
        expect(yield* fs.exists(join(treeRoot, 'demo/trashed-target'))).toBe(false);
        expect((yield* graph.blocks.rawBlockById(child.id)).path).toBe(null);
        const path = 'demo/holder.md';
        const byAct = yield* fs.readFileString(join(treeRoot, path));
        expect((yield* decodeBlockFile(byAct)).frontmatter.edges).toEqual([{ kind: 'relates', to: gone.uuid }]);
        yield* projectToTree({ projectId, treeRoot });
        expect(yield* fs.readFileString(join(treeRoot, path))).toBe(byAct);
        const ledger = yield* treeLedger({ root: treeRoot, stealth: null }, projectId);
        expect(yield* ledger.unreflected([{ status: 'M', path }])).toEqual([]);
      }),
    ),
  );
});
