import { expect } from 'bun:test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem, Layer } from 'effect';
import { eq } from 'drizzle-orm';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../graphFixture.js';
import { spokenId } from '../../../../platform/contract/wire/ids.js';
import { block, blockField, blockTag, edge, ref } from '../../../../graph/store/tables.js';
import { mintedAt } from '../../../../graph/contract/wire/identity.js';
import { tagNodeFields } from '../../../../graph/vocabulary/declarationRules.js';
import { tagsOfCatalogs } from '../../../../catalogs/contract/wire/registry.js';
import { CORE_LIBRARY } from '../../../../graph/contract/wire/tags/identity.js';
import type { TreeBlock } from '../../../../graph/tree/layout.js';
import { writeBlockTree } from '../../../../graph/tree/layout.js';
import { indexMirror, rebuildMirror, repairMirror } from '../../../../graph/tree/mirror.js';
import { scanTree } from '../../../../graph/tree/scan.js';

const A = '0198aaaa-0000-7000-8000-00000000a001';
const B = '0198aaaa-0000-7000-8000-00000000b002';
const C = '0198aaaa-0000-7000-8000-00000000c003';
const D = '0198aaaa-0000-7000-8000-00000000d004';
const TAG_MODULE = '0198aaaa-0000-7000-8000-00000000e005';
const TAG_IDEA = '0198aaaa-0000-7000-8000-00000000e006';
const TAG_TASK = '0198aaaa-0000-7000-8000-00000000e007';

const declaring = (id: string, uuid: string, ord: number): TreeBlock => {
  const tag = tagsOfCatalogs([CORE_LIBRARY, 'software-development']).find((candidate) => candidate.id === id);
  if (tag === undefined) throw new Error(`the software-development catalog declares no #${id}`);
  return {
    parentId: A,
    frontmatter: { id: uuid, tags: ['tag'], title: `#${id}`, ord, fields: tagNodeFields(tag) },
    body: tag.prompt,
  };
};

const blocks: TreeBlock[] = [
  { parentId: null, frontmatter: { id: A, tags: ['module'], title: 'Doctrine', ord: 1 }, body: 'What never bends.' },
  {
    parentId: A,
    frontmatter: { id: B, tags: ['idea'], title: 'Palladium Charter', ord: 1, edges: [{ kind: 'relates', to: C }] },
    body: 'The palladium clause holds the whole floor.',
  },
  {
    parentId: A,
    frontmatter: {
      id: C,
      tags: ['task'],
      title: 'The Next Shape',
      ord: 2,
      fields: { status: 'open' },
      edges: [{ kind: 'relates', to: B }],
    },
    body: 'It points at [[0000b002]] by suffix, and at a dead one: [[deadbeef]].',
  },
  declaring('module', TAG_MODULE, 3),
  declaring('idea', TAG_IDEA, 4),
  declaring('task', TAG_TASK, 5),
];

const declarations = [TAG_MODULE, TAG_IDEA, TAG_TASK];

const prepare = Effect.fn('mirrorFixture.prepare')(function* (demo: EffectDemo, tree: readonly TreeBlock[] = blocks) {
  const treeRoot = yield* demo.fixture.directory('tree');
  yield* writeBlockTree(treeRoot, tree);
  const scan = yield* scanTree(treeRoot);
  const built = yield* rebuildMirror(scan, demo.projectId);
  return { treeRoot, scan, built, db: demo.graph.graphStore.db };
});

layer(demoGraphLayer().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('mirror contracts', (it) => {
  it.effect('fresh copies reproduce handles, derived rows and search; later growth preserves existing identities', () =>
    Effect.gen(function* () {
      const first = yield* withDemo((demo) =>
        Effect.gen(function* () {
          const bootstrap = yield* demo.graph.graphStore.db.select().from(block);
          const { built, db } = yield* prepare(demo);
          expect([...built.ids.keys()].sort()).toEqual(
            [...blocks.map((row) => row.frontmatter.id), ...bootstrap.map((row) => row.uuid)].sort(),
          );
          const rows = yield* db.select().from(block);
          expect(
            rows
              .filter((row) => row.deletedAt === null)
              .map((row) => row.uuid)
              .sort(),
          ).toEqual(blocks.map((row) => row.frontmatter.id).sort());
          for (const row of bootstrap)
            expect(rows.find((item) => item.uuid === row.uuid)).toMatchObject({ id: row.id, deletedAt: expect.any(Date), path: null });
          expect(built.deadEdges).toEqual([]);
          const root = yield* demo.graph.blocks.rawBlockById(built.ids.get(A)!);
          const child = yield* demo.graph.blocks.rawBlockById(built.ids.get(B)!);
          expect(child).toMatchObject({ uuid: B, parentId: root.id });
          expect(root.createdAt.getTime()).toBe(mintedAt(A)!.getTime());
          expect(root.updatedAt.getTime()).toBeGreaterThanOrEqual(root.createdAt.getTime());
          const taskId = built.ids.get(C)!;
          expect(
            (yield* db.select().from(edge).orderBy(edge.fromId, edge.toId)).map(({ fromId, toId, kind }) => ({ fromId, toId, kind })),
          ).toEqual([
            { fromId: child.id, toId: taskId, kind: 'relates' },
            { fromId: taskId, toId: child.id, kind: 'relates' },
          ]);
          expect(yield* db.select({ fromId: ref.fromId, toId: ref.toId }).from(ref)).toEqual([{ fromId: taskId, toId: child.id }]);
          const indexed = yield* db.select().from(blockTag).orderBy(blockTag.blockId, blockTag.tag);
          expect(indexed.find((row) => row.blockId === built.ids.get(C))?.typeId).toBe(`local:${TAG_TASK.replaceAll('-', '')}`);
          expect(
            (yield* demo.graph.ranking.search({ query: 'palladium', projectId: demo.projectId })).items.map((hit) => hit.name),
          ).toEqual([spokenId(B)]);
          return { ids: blocks.map((row) => built.ids.get(row.frontmatter.id)), indexed };
        }),
      );
      yield* withDemo((demo) =>
        Effect.gen(function* () {
          const { treeRoot, built, db } = yield* prepare(demo);
          expect(blocks.map((row) => built.ids.get(row.frontmatter.id))).toEqual(first.ids);
          expect(yield* db.select().from(blockTag).orderBy(blockTag.blockId, blockTag.tag)).toEqual(first.indexed);
          expect(
            (yield* demo.graph.ranking.search({ query: 'palladium', projectId: demo.projectId })).items.map((hit) => hit.name),
          ).toEqual([spokenId(B)]);
          const late = '0198bbbb-0000-7000-8000-000000000001';
          yield* writeBlockTree(treeRoot, [
            ...blocks,
            { parentId: A, frontmatter: { id: late, tags: ['idea'], title: 'Newcomer', ord: 6 }, body: 'arrived later' },
          ]);
          const grown = yield* rebuildMirror(yield* scanTree(treeRoot), demo.projectId);
          expect(blocks.map((row) => grown.ids.get(row.frontmatter.id))).toEqual(first.ids);
          expect(grown.ids.get(late)).toBeGreaterThan(Math.max(...built.ids.values()));
        }),
      );
    }),
  );

  for (const absorb of ['repair', 'rebuild'] as const) {
    it.effect(`an identity arriving through ${absorb} resolves references through trash and revival`, () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const foreign = '0198aaaa-0000-7000-8000-0000deadbeef';
          const { treeRoot, built, db } = yield* prepare(demo, [
            blocks[0]!,
            {
              parentId: A,
              frontmatter: { id: B, tags: ['idea'], title: 'Referrer', ord: 1 },
              body: `The body names [[${spokenId(foreign)}]] before it arrives.`,
            },
          ]);
          const fromId = built.ids.get(B)!;
          const references = () => db.select({ fromId: ref.fromId, toId: ref.toId }).from(ref).where(eq(ref.fromId, fromId));
          expect(yield* references()).toEqual([]);
          const fs = yield* FileSystem.FileSystem;
          const path = 'doctrine/foreign-identity.md';
          const target = `---\nid: ${foreign}\ntags: ["idea"]\ntitle: Foreign Identity\nord: 2\n---\nThe identity arrived.\n`;
          yield* fs.writeFileString(join(treeRoot, path), target);
          if (absorb === 'repair') yield* repairMirror({ root: treeRoot, stealth: null }, [{ status: 'A', path }], demo.projectId);
          else yield* rebuildMirror(yield* scanTree(treeRoot), demo.projectId);
          const names = yield* demo.graph.blockNames.idsOfNames([spokenId(foreign)]);
          const toId = names.get(spokenId(foreign))!;
          expect(yield* demo.graph.blocks.rawBlockById(toId)).toMatchObject({ uuid: foreign, id: toId });
          const pair = [{ fromId, toId }];
          expect(yield* references()).toEqual(pair);
          yield* fs.remove(join(treeRoot, path));
          yield* rebuildMirror(yield* scanTree(treeRoot), demo.projectId);
          expect(yield* demo.graph.blocks.rawBlockById(toId)).toMatchObject({ uuid: foreign, deletedAt: expect.any(Date), path: null });
          expect(yield* references()).toEqual(pair);
          yield* fs.writeFileString(join(treeRoot, path), target);
          yield* rebuildMirror(yield* scanTree(treeRoot), demo.projectId);
          expect(yield* demo.graph.blocks.rawBlockById(toId)).toMatchObject({ uuid: foreign, deletedAt: null, path });
          expect(yield* references()).toEqual(pair);
        }),
      ),
    );
  }

  it.effect('rebuild and incremental repair keep the holder while upserting and trashing only their delta', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { treeRoot, scan, built, db } = yield* prepare(demo);
        const taskId = built.ids.get(C)!;
        const claimed = yield* demo.as('k1', demo.graph.tasks.claim({ id: taskId }));
        const holder = (yield* demo.table()).holderOf(claimed);
        expect(holder).not.toBeNull();
        yield* rebuildMirror(scan, demo.projectId);
        expect((yield* demo.table()).holderOf(yield* demo.graph.blocks.rawBlockById(taskId))).toBe(holder);
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          join(treeRoot, 'doctrine/palladium-charter.md'),
          `---\nid: ${B}\ntags: ["idea"]\ntitle: Palladium Charter\nord: 1\n---\nNow it points at [[0000c003]].`,
        );
        yield* fs.writeFileString(
          join(treeRoot, 'doctrine/newcomer.md'),
          `---\nid: ${D}\ntags: ["idea"]\ntitle: Newcomer\nord: 6\n---\nborn in the delta`,
        );
        const repaired = yield* repairMirror(
          { root: treeRoot, stealth: null },
          [
            { status: 'M', path: 'doctrine/palladium-charter.md' },
            { status: 'A', path: 'doctrine/newcomer.md' },
          ],
          demo.projectId,
        );
        expect(repaired).toMatchObject({ upserted: 2, removed: 0 });
        const b = yield* demo.graph.blocks.rawBlockById(built.ids.get(B)!);
        const names = yield* demo.graph.blockNames.idsOfNames([spokenId(D)]);
        const d = yield* demo.graph.blocks.rawBlockById(names.get(spokenId(D))!);
        expect(b).toMatchObject({ uuid: B, body: `Now it points at [[${spokenId(C)}]].` });
        expect(d.parentId).toBe(built.ids.get(A)!);
        expect((yield* demo.table()).holderOf(yield* demo.graph.blocks.rawBlockById(taskId))).toBe(holder);
        expect(yield* db.select({ fromId: ref.fromId, toId: ref.toId }).from(ref)).toContainEqual({ fromId: b.id, toId: taskId });
        yield* fs.remove(join(treeRoot, 'doctrine/newcomer.md'));
        expect(
          yield* repairMirror({ root: treeRoot, stealth: null }, [{ status: 'D', path: 'doctrine/newcomer.md' }], demo.projectId),
        ).toMatchObject({
          removed: 1,
        });
        expect(yield* demo.graph.blocks.rawBlockById(d.id)).toMatchObject({
          uuid: D,
          body: 'born in the delta',
          deletedAt: expect.any(Date),
          path: null,
        });
        expect(
          (yield* db.select().from(block))
            .filter((row) => row.deletedAt === null)
            .map((row) => row.uuid)
            .sort(),
        ).toEqual(blocks.map((row) => row.frontmatter.id).sort());
        yield* rebuildMirror({ ...scan, blocks: scan.blocks.filter((row) => !declarations.includes(row.frontmatter.id)) }, demo.projectId);
        expect((yield* demo.graph.blocks.rawBlockById(taskId)).fields).toEqual({ status: 'open' });
      }),
    ),
  );

  it.effect('the tree vocabulary projects fields and names unread values and UTF-16 caps; multiple roots roll back', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const stray = '0198aaaa-0000-7000-8000-00000000f008';
        const law = '0198aaaa-0000-7000-8000-00000000a009';
        const over = 'MUST NOT bend 🪨. ';
        const bounded = declaring('rule', '0198aaaa-0000-7000-8000-00000000e009', 6);
        const cap = over.length - 1;
        const tree: TreeBlock[] = [
          ...blocks,
          {
            parentId: A,
            frontmatter: { id: stray, tags: ['idea'], title: 'Hand Edited', ord: 7, fields: { invoice: 3 } },
            body: 'an undeclared field',
          },
          {
            ...bounded,
            frontmatter: { ...bounded.frontmatter, fields: { ...bounded.frontmatter.fields, body: { shape: 'content', cap } } },
          },
          { parentId: A, frontmatter: { id: law, tags: ['rule'], title: 'The Long Law', ord: 8 }, body: over },
        ];
        const { treeRoot, built, db } = yield* prepare(demo, tree);
        expect(
          yield* db
            .select()
            .from(blockField)
            .where(eq(blockField.blockId, built.ids.get(C)!)),
        ).toContainEqual(expect.objectContaining({ tag: 'task', name: 'status', value: 'open' }));
        expect(built.unreadFields.map((row) => row.id).sort()).toEqual([stray, law].sort());
        expect(built.unreadFields.find((row) => row.id === stray)?.reason).toContain('invoice');
        expect((yield* demo.graph.blocks.rawBlockById(built.ids.get(stray)!)).fields).toEqual({ invoice: 3 });
        expect(built.unreadFields.find((row) => row.id === law)).toMatchObject({
          path: 'doctrine/the-long-law.md',
          reason: expect.stringContaining(String(cap)),
        });
        expect((yield* demo.graph.blocks.rawBlockById(built.ids.get(law)!)).body).toBe(over);
        const before = yield* db.select().from(block).orderBy(block.id);
        yield* writeBlockTree(treeRoot, [
          ...tree,
          { parentId: null, frontmatter: { id: D, tags: ['idea'], title: 'Stray', ord: 9 }, body: '' },
        ]);
        const refused = yield* Effect.flip(rebuildMirror(yield* scanTree(treeRoot), demo.projectId));
        expect(refused).toMatchObject({ _tag: 'MirrorRefused', reason: 'many-roots' });
        expect(yield* db.select().from(block).orderBy(block.id)).toEqual(before);
      }),
    ),
  );

  it.effect('document references retain their identities when a view sorts before its target', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const target = '0198f000-0000-7000-8000-0000000000ff';
        const view = '0198a000-0000-7000-8000-000000000001';
        const spoken = (uuid: string) => uuid.replaceAll('-', '').slice(-8);
        const { built } = yield* prepare(demo, [
          { parentId: null, frontmatter: { id: target, tags: ['module'], title: 'Root', ord: 1 }, body: 'the target' },
          {
            parentId: target,
            frontmatter: {
              id: view,
              tags: ['view'],
              title: 'A slice',
              ord: 2,
              fields: { query: { scope: [spoken(target)], sort: { by: 'updated', order: 'desc' } } },
            },
            body: 'what it selects',
          },
        ]);
        expect((yield* demo.graph.blocks.rawBlockById(built.ids.get(view)!)).fields['query']).toEqual({
          scope: [spokenId(target)],
          sort: { by: 'updated', order: 'desc' },
        });
        expect(built.ids.get(view)).toBeLessThan(built.ids.get(target)!);
      }),
    ),
  );

  it.effect('worker-sized bodies are searchable to their last words; indexing removes unrestorable rows and their derived tags', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const large: TreeBlock = {
          parentId: A,
          frontmatter: { id: B, tags: ['idea'], title: 'Ledger of Winds', ord: 1 },
          body: `${'The steady wind turns the mill. '.repeat(1_200)}At last the obsidian lighthouse answers.`,
        };
        const { db } = yield* prepare(demo, [blocks[0]!, large]);
        expect(
          (yield* demo.graph.ranking.search({ query: 'obsidian lighthouse', projectId: demo.projectId })).items.map((hit) => hit.name),
        ).toEqual([spokenId(B)]);
        const loose = '0198aaaa-0000-7000-8000-00000000f00f';
        const at = new Date(0);
        const row = yield* db
          .insert(block)
          .values({
            uuid: loose,
            projectId: demo.projectId,
            ord: 9,
            title: 'Loose',
            tags: ['idea'],
            createdAt: at,
            updatedAt: at,
            deletedAt: at,
          })
          .returning()
          .get();
        if (row === undefined) return yield* Effect.die('the unrestorable seed returned no row');
        yield* db.insert(blockTag).values({ blockId: row.id, tag: 'idea' });
        yield* indexMirror(demo.projectId);
        expect(yield* db.select().from(block).where(eq(block.uuid, loose))).toEqual([]);
        expect(yield* db.select().from(blockTag).where(eq(blockTag.blockId, row.id))).toEqual([]);
      }),
    ),
  );
});
