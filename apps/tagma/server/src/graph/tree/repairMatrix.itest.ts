import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Effect, FileSystem, Layer } from 'effect';
import { type EffectDemo, demoGraphLayer, refusalOf, withDemo } from '../../composition/testing/graphFixture.js';
import { spokenId } from '../../platform/contract/wire/ids.js';
import { block, edge, ref, source } from '../store/tables.js';
import { type BlockFrontmatter, encodeBlockFile } from './blockFile.js';
import { type TreeBlock, writeBlockTree } from './layout.js';
import { type TreeChange } from './freshness.js';
import { MirrorRefused, rebuildMirror, repairMirror } from './mirror.js';
import { scanTree } from './scan.js';
import { projectToTree } from './projection.js';

const A = '0198ffff-0000-7000-8000-00000000a001';
const B = '0198ffff-0000-7000-8000-00000000b002';
const C = '0198ffff-0000-7000-8000-00000000c003';
const D = '0198ffff-0000-7000-8000-00000000d004';
const E = '0198ffff-0000-7000-8000-00000000e005';
const F = '0198ffff-0000-7000-8000-00000000f006';
const initial: TreeBlock[] = [
  { parentId: null, frontmatter: { id: A, title: 'Root Hall', ord: 1 }, body: 'the hall' },
  { parentId: A, frontmatter: { id: B, tags: ['idea'], title: 'Ledger', ord: 1 }, body: 'the ledger' },
  {
    parentId: A,
    frontmatter: {
      id: C,
      tags: ['idea'],
      title: 'Charter',
      ord: 2,
      sources: [{ kind: 'file', ref: 'src/a.ts' }],
      edges: [{ kind: 'relates', to: B }],
    },
    body: 'the charter',
  },
];

const mirrors = demoGraphLayer({
  prepareEffect: Effect.fn('repairFixture.prepare')(function* (demo: EffectDemo) {
    const tree = yield* demo.fixture.directory('initial-tree');
    yield* writeBlockTree(tree, initial);
    yield* rebuildMirror(yield* scanTree(tree), demo.projectId);
  }),
}).pipe(Layer.provideMerge(BunFileSystem.layer));

const withMirror = <X, F, R>(body: (mirror: Effect.Success<ReturnType<typeof mirrorAt>>) => Effect.Effect<X, F, R>) =>
  withDemo((demo) => Effect.flatMap(mirrorAt(demo), body));

const mirrorAt = Effect.fn('repairFixture.open')(function* (demo: EffectDemo) {
  const { graph, projectId } = demo;
  const { db } = graph.graphStore;
  const fs = yield* FileSystem.FileSystem;
  const tree = yield* demo.fixture.directory('tree');
  yield* writeBlockTree(tree, initial);
  const byUuid = (uuid: string) => Effect.flatMap(graph.blockNames.idOfName(uuid), graph.blocks.rawBlockById);
  const file = (path: string, id: string, title: string, body: string, extra: Partial<BlockFrontmatter> = {}) =>
    fs.writeFileString(join(tree, path), encodeBlockFile({ frontmatter: { id, tags: ['idea'], title, ord: 1, ...extra }, body }));
  const state = Effect.gen(function* () {
    return {
      blocks: yield* db.select().from(block).orderBy(block.id),
      edges: yield* db.select().from(edge).orderBy(edge.fromId, edge.toId, edge.kind),
      refs: yield* db.select().from(ref).orderBy(ref.fromId, ref.toId),
      sources: yield* db.select().from(source).orderBy(source.id),
    };
  });
  return {
    graph,
    projectId,
    tree,
    fs,
    db,
    file,
    byUuid,
    state,
    repair: (changes: readonly TreeChange[]) => repairMirror({ root: tree, stealth: null }, changes, projectId),
    rebuild: Effect.flatMap(scanTree(tree), (scan) => rebuildMirror(scan, projectId)),
  };
});

layer(mirrors, { excludeTestServices: true })('mirror repair contracts', (it) => {
  it.effect('an edited body is searchable, keeps its written reference and identity through a rename', () =>
    withMirror(({ graph, projectId, tree, fs, db, file, byUuid, repair }) =>
      Effect.gen(function* () {
        const ledger = yield* byUuid(B);
        const charter = yield* byUuid(C);
        const body = `the ledger, amended; points at [[${spokenId(C)}]] now`;
        yield* file('root-hall/ledger.md', B, 'Ledger', body);
        expect((yield* repair([{ status: 'M', path: 'root-hall/ledger.md' }])).upserted).toBe(1);
        expect(yield* byUuid(B)).toMatchObject({ id: ledger.id, uuid: B, body });
        expect((yield* graph.ranking.search({ projectId, query: 'amended' })).items.map((hit) => hit.name)).toEqual([spokenId(B)]);
        expect(yield* db.select({ fromId: ref.fromId, toId: ref.toId }).from(ref).where(eq(ref.fromId, ledger.id))).toEqual([
          { fromId: ledger.id, toId: charter.id },
        ]);
        yield* fs.rename(join(tree, 'root-hall/ledger.md'), join(tree, 'root-hall/the-big-ledger.md'));
        expect(
          yield* repair([
            { status: 'D', path: 'root-hall/ledger.md' },
            { status: 'A', path: 'root-hall/the-big-ledger.md' },
          ]),
        ).toMatchObject({ removed: 0, upserted: 1 });
        expect(yield* byUuid(B)).toMatchObject({ id: ledger.id, uuid: B, body, path: 'root-hall/the-big-ledger.md', deletedAt: null });
      }),
    ),
  );

  it.effect(
    'child-first arrivals resolve forward edges, and a displaced parent is restorable while its live child follows the replacement',
    () =>
      withMirror(({ graph, projectId, tree, fs, db, file, byUuid, repair }) =>
        Effect.gen(function* () {
          yield* fs.makeDirectory(join(tree, 'root-hall/annex'));
          yield* file('root-hall/annex/index.md', D, 'Annex', 'the annex', { edges: [{ kind: 'relates', to: E }] });
          yield* file('root-hall/annex/shelf.md', E, 'Shelf', 'the shelf');
          expect(
            (yield* repair([
              { status: 'A', path: 'root-hall/annex/shelf.md' },
              { status: 'A', path: 'root-hall/annex/index.md' },
            ])).upserted,
          ).toBe(2);
          const annex = yield* byUuid(D);
          const shelf = yield* byUuid(E);
          expect(shelf).toMatchObject({ uuid: E, parentId: annex.id, body: 'the shelf' });
          expect(
            yield* db.select({ fromId: edge.fromId, toId: edge.toId, kind: edge.kind }).from(edge).where(eq(edge.fromId, annex.id)),
          ).toEqual([{ fromId: annex.id, toId: shelf.id, kind: 'relates' }]);
          yield* file('root-hall/annex/index.md', F, 'Annex', 'the replacement');
          expect((yield* repair([{ status: 'M', path: 'root-hall/annex/index.md' }])).removed).toBe(1);
          expect(yield* byUuid(D)).toMatchObject({ id: annex.id, uuid: D, deletedAt: expect.any(Date), path: null, body: 'the annex' });
          expect((yield* graph.trash.roots(projectId)).map((row) => row.id)).toContain(annex.id);
          const replacement = yield* byUuid(F);
          expect(replacement).toMatchObject({ uuid: F, path: 'root-hall/annex/index.md', body: 'the replacement' });
          expect(yield* byUuid(E)).toMatchObject({ id: shelf.id, parentId: replacement.id, deletedAt: null });
        }),
      ),
  );

  it.effect('a departing unbound successor does not compete with the live successor when their target arrives', () =>
    withMirror(({ tree, fs, db, file, byUuid, repair }) =>
      Effect.gen(function* () {
        yield* file('root-hall/old.md', D, 'Old successor', 'old', { edges: [{ kind: 'supersedes', to: F }] });
        yield* repair([{ status: 'A', path: 'root-hall/old.md' }]);
        yield* fs.remove(join(tree, 'root-hall/old.md'));
        yield* repair([{ status: 'D', path: 'root-hall/old.md' }]);
        yield* file('root-hall/new.md', E, 'New successor', 'new', { edges: [{ kind: 'supersedes', to: F }] });
        yield* repair([{ status: 'A', path: 'root-hall/new.md' }]);
        yield* file('root-hall/target.md', F, 'Target', 'the target');
        yield* repair([{ status: 'A', path: 'root-hall/target.md' }]);
        const successor = yield* byUuid(E);
        const target = yield* byUuid(F);
        expect(yield* db.select({ fromId: edge.fromId }).from(edge).where(eq(edge.toId, target.id))).toEqual([{ fromId: successor.id }]);
      }),
    ),
  );

  it.effect('an unresolved local edge survives projection and binds when its target file arrives alone', () =>
    withMirror(({ projectId, tree, db, file, byUuid, repair }) =>
      Effect.gen(function* () {
        const charter = yield* byUuid(C);
        yield* file('root-hall/charter.md', C, 'Charter', 'the charter', { edges: [{ kind: 'relates', to: D }] });
        expect((yield* repair([{ status: 'M', path: 'root-hall/charter.md' }])).deadEdges).toEqual([{ fromId: C, to: D }]);
        yield* projectToTree({ projectId, treeRoot: tree });
        expect((yield* scanTree(tree)).blocks.find((row) => row.frontmatter.id === C)?.frontmatter.edges).toEqual([
          { kind: 'relates', to: D },
        ]);
        yield* file('root-hall/arrival.md', D, 'Arrival', 'the arriving knowledge');
        yield* repair([{ status: 'A', path: 'root-hall/arrival.md' }]);
        const arrived = yield* byUuid(D);
        expect(yield* db.select({ toId: edge.toId, kind: edge.kind }).from(edge).where(eq(edge.fromId, charter.id))).toEqual([
          { toId: arrived.id, kind: 'relates' },
        ]);
      }),
    ),
  );

  it.effect('deleting a file journals a trash batch that the public restore brings back intact', () =>
    withMirror(({ graph, projectId, tree, fs, byUuid, repair }) =>
      Effect.gen(function* () {
        const ledger = yield* byUuid(B);
        yield* fs.remove(join(tree, 'root-hall/ledger.md'));
        expect((yield* repair([{ status: 'D', path: 'root-hall/ledger.md' }])).removed).toBe(1);
        expect(yield* byUuid(B)).toMatchObject({ id: ledger.id, uuid: B, body: 'the ledger', deletedAt: expect.any(Date), path: null });
        expect((yield* graph.trash.roots(projectId)).map((row) => row.id)).toContain(ledger.id);
        yield* graph.trash.restore({ id: ledger.id });
        expect(yield* byUuid(B)).toMatchObject({ id: ledger.id, uuid: B, body: 'the ledger', deletedAt: null });
      }),
    ),
  );

  it.effect('a mass external change lands every arrival and reads a vanished modified path as gone', () =>
    withMirror(({ tree, fs, file, byUuid, repair }) =>
      Effect.gen(function* () {
        const ids = Array.from({ length: 40 }, (_, at) => `0198ffff-0000-7000-8000-1000000000${at.toString(16).padStart(2, '0')}`);
        for (const [at, id] of ids.entries()) yield* file(`root-hall/mass-${at}.md`, id, `Mass ${at}`, `mass ${at}`);
        yield* fs.remove(join(tree, 'root-hall/ledger.md'));
        expect(
          yield* repair([
            ...ids.map((_, at): TreeChange => ({ status: 'A', path: `root-hall/mass-${at}.md` })),
            { status: 'M', path: 'root-hall/ledger.md' },
          ]),
        ).toMatchObject({ upserted: 40, removed: 1 });
        expect(yield* byUuid(ids[39] as string)).toMatchObject({ body: 'mass 39', path: 'root-hall/mass-39.md', deletedAt: null });
        expect(yield* byUuid(B)).toMatchObject({ deletedAt: expect.any(Date), path: null });
      }),
    ),
  );

  it.effect('a parent revived by its file leaves the missing child with its own restorable batch', () =>
    withMirror(({ graph, projectId, tree, fs, file, byUuid, repair }) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(join(tree, 'root-hall/vault'));
        yield* file('root-hall/vault/index.md', D, 'Vault', 'the vault');
        yield* file('root-hall/vault/coin.md', E, 'Coin', 'the coin');
        yield* repair([
          { status: 'A', path: 'root-hall/vault/index.md' },
          { status: 'A', path: 'root-hall/vault/coin.md' },
        ]);
        const coin = yield* byUuid(E);
        yield* fs.remove(join(tree, 'root-hall/vault/coin.md'));
        yield* fs.remove(join(tree, 'root-hall/vault/index.md'));
        yield* repair([
          { status: 'D', path: 'root-hall/vault/index.md' },
          { status: 'D', path: 'root-hall/vault/coin.md' },
        ]);
        yield* file('root-hall/vault/index.md', D, 'Vault', 'the vault');
        yield* repair([{ status: 'A', path: 'root-hall/vault/index.md' }]);
        const vault = yield* byUuid(D);
        expect(vault).toMatchObject({ uuid: D, body: 'the vault', deletedAt: null });
        expect(yield* byUuid(E)).toMatchObject({ id: coin.id, uuid: E, parentId: vault.id, body: 'the coin', deletedAt: expect.any(Date) });
        expect((yield* graph.trash.roots(projectId)).map((row) => row.id)).toContain(coin.id);
        yield* graph.trash.restore({ id: coin.id });
        expect(yield* byUuid(E)).toMatchObject({ id: coin.id, uuid: E, parentId: vault.id, body: 'the coin', deletedAt: null });
      }),
    ),
  );

  it.effect('a departing successor releases its predecessor for the successor arriving in the same delta', () =>
    withMirror(({ tree, fs, db, file, byUuid, repair }) =>
      Effect.gen(function* () {
        yield* file('root-hall/first-heir.md', D, 'First Heir', 'replaces the charter', { edges: [{ kind: 'supersedes', to: C }] });
        yield* repair([{ status: 'A', path: 'root-hall/first-heir.md' }]);
        const first = yield* byUuid(D);
        yield* fs.remove(join(tree, 'root-hall/first-heir.md'));
        yield* file('root-hall/second-heir.md', E, 'Second Heir', 'replaces the charter', { edges: [{ kind: 'supersedes', to: C }] });
        yield* repair([
          { status: 'D', path: 'root-hall/first-heir.md' },
          { status: 'A', path: 'root-hall/second-heir.md' },
        ]);
        const charter = yield* byUuid(C);
        const second = yield* byUuid(E);
        expect(yield* byUuid(D)).toMatchObject({ id: first.id, uuid: D, deletedAt: expect.any(Date) });
        expect(yield* db.select({ fromId: edge.fromId, kind: edge.kind }).from(edge).where(eq(edge.toId, charter.id))).toEqual([
          { fromId: second.id, kind: 'supersedes' },
        ]);
      }),
    ),
  );

  for (const refusal of ['orphan', 'second-root', 'malformed'] as const) {
    it.effect(`${refusal} refuses without landing a valid earlier arrival or changing stored projections`, () =>
      withMirror(({ tree, fs, file, repair, state }) =>
        Effect.gen(function* () {
          const before = yield* state;
          yield* file('root-hall/half.md', D, 'Half', 'would land');
          const path = refusal === 'orphan' ? 'root-hall/nowhere/lost.md' : refusal === 'second-root' ? 'stray.md' : 'root-hall/poison.md';
          if (refusal === 'orphan') yield* fs.makeDirectory(join(tree, 'root-hall/nowhere'));
          if (refusal === 'malformed') yield* fs.writeFileString(join(tree, path), 'not a block');
          else yield* file(path, E, 'Stray', 'must refuse');
          const failure = yield* Effect.flip(
            repair([
              { status: 'A', path: 'root-hall/half.md' },
              { status: 'A', path },
            ]),
          );
          expect(failure).toBeInstanceOf(MirrorRefused);
          if (!(failure instanceof MirrorRefused)) return yield* Effect.die(failure);
          expect(failure.reason).toBe(refusal === 'second-root' ? 'many-roots' : 'repair');
          expect(failure.message).toContain(path);
          expect(yield* state).toEqual(before);
        }),
      ),
    );
  }

  for (const duplicate of ['standing', 'arrivals', 'rebuild'] as const) {
    it.effect(`${duplicate} rejects duplicate identity with both paths and leaves the mirror unchanged`, () =>
      withMirror(({ file, repair, rebuild, state }) =>
        Effect.gen(function* () {
          const before = yield* state;
          const first = duplicate === 'arrivals' ? 'root-hall/twin-one.md' : 'root-hall/charter.md';
          const second = 'root-hall/twin-two.md';
          const id = duplicate === 'arrivals' ? D : C;
          if (duplicate === 'arrivals') yield* file(first, id, 'Twin', 'one');
          yield* file(second, id, 'Twin', 'two');
          const failure = yield* duplicate === 'rebuild'
            ? refusalOf(rebuild)
            : refusalOf(repair([...(duplicate === 'arrivals' ? [{ status: 'A', path: first }] : []), { status: 'A', path: second }]));
          expect(failure.code).toBe('duplicate-identity');
          expect(failure.reason).toContain(first);
          expect(failure.reason).toContain(second);
          expect(yield* state).toEqual(before);
        }),
      ),
    );
  }

  it.effect('rebuild preserves earlier trash, newly missing sources and edges, and reparents a former root under the live root', () =>
    withMirror(({ graph, projectId, tree, fs, db, file, byUuid, repair, rebuild }) =>
      Effect.gen(function* () {
        const ledger = yield* byUuid(B);
        const charter = yield* byUuid(C);
        const hall = yield* byUuid(A);
        yield* fs.remove(join(tree, 'root-hall/ledger.md'));
        yield* repair([{ status: 'D', path: 'root-hall/ledger.md' }]);
        yield* fs.remove(join(tree, 'root-hall/charter.md'));
        yield* rebuild;
        expect(yield* byUuid(B)).toMatchObject({ id: ledger.id, uuid: B, body: 'the ledger', deletedAt: expect.any(Date) });
        expect(yield* byUuid(C)).toMatchObject({ id: charter.id, uuid: C, body: 'the charter', deletedAt: expect.any(Date), path: null });
        expect((yield* graph.trash.roots(projectId)).map((row) => row.id)).toEqual(expect.arrayContaining([ledger.id, charter.id]));
        expect(yield* db.select({ toId: edge.toId, kind: edge.kind }).from(edge).where(eq(edge.fromId, charter.id))).toEqual([
          { toId: ledger.id, kind: 'relates' },
        ]);
        expect(yield* db.select({ kind: source.kind, ref: source.ref }).from(source).where(eq(source.blockId, charter.id))).toEqual([
          { kind: 'file', ref: 'src/a.ts' },
        ]);
        yield* fs.remove(join(tree, 'root-hall'), { recursive: true });
        yield* file('new-root.md', D, 'New Root', 'the live root', { tags: [] });
        yield* rebuild;
        const root = yield* byUuid(D);
        expect(yield* byUuid(A)).toMatchObject({ id: hall.id, uuid: A, body: 'the hall', parentId: root.id, deletedAt: expect.any(Date) });
        yield* graph.trash.restore({ id: hall.id });
        expect(yield* byUuid(A)).toMatchObject({ id: hall.id, uuid: A, parentId: root.id, deletedAt: null });
        expect((yield* graph.selection.roots(projectId)).map((row) => row.uuid)).toEqual([D]);
      }),
    ),
  );
});
