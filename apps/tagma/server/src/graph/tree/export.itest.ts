import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem } from 'effect';
import { writeBlockTree } from './layout.js';
import { type BlockConnections, type ExportBlockRow, ExportFailed, exportGraphRows } from './export.js';
import { scanTree } from './scan.js';

const rows = [
  {
    id: 1,
    uuid: '01a03991-45fa-70d8-ac24-000000000001',
    parentId: null,
    ord: 1,
    tags: ['zone'],
    fields: {},
    title: 'The Server',
    body: 'Storage law first — [[2962c162]]; a dead one: [[deadbeef]].',
    deletedAt: null,
  },
  {
    id: 2,
    uuid: '01a03991-45fa-70d8-ac24-000000000002',
    parentId: 1,
    ord: 1,
    tags: ['idea'],
    fields: {},
    title: 'One File',
    body: 'one writer',
    deletedAt: null,
  },
  {
    id: 3,
    uuid: '01a03991-45fa-70d8-ac24-000000000003',
    parentId: 1,
    ord: 2,
    tags: ['spec'],
    fields: { status: 'open', enabled: false },
    title: 'Files as truth',
    body: 'labeled ref: [[2962c162|the storage law]]',
    deletedAt: null,
  },
  {
    id: 5,
    uuid: '01a03991-45fa-70d8-ac24-000000000005',
    parentId: 1,
    ord: 3,
    tags: ['view'],
    fields: { layout: { mode: 'list' } },
    title: 'In the trash',
    body: '',
    deletedAt: new Date('2026-08-25T10:00:00.000Z'),
  },
] as const satisfies readonly ExportBlockRow[];

const connections: BlockConnections = {
  edges: new Map([
    [
      3,
      [
        { kind: 'implements', to: rows[1].uuid },
        { kind: 'relates', to: rows[3].uuid },
      ],
    ],
  ]),
  sources: new Map([
    [
      2,
      [
        { kind: 'file', ref: 'src/db/Store.ts', symbol: null },
        { kind: 'symbol', ref: 'src/db/Store.ts', symbol: 'Store' },
      ],
    ],
  ]),
  sessions: new Map(),
};

layer(BunFileSystem.layer, { excludeTestServices: true })('the exporter', (it) => {
  it.effect('live identities, parenthood, bodies, fields and connections round-trip through disk, including edges into trash', () =>
    Effect.gen(function* () {
      const tree = yield* exportGraphRows(rows, connections);
      expect(tree.map((block) => block.frontmatter.id)).toEqual(rows.slice(0, 3).map((row) => row.uuid));
      const root = tree.find((block) => block.frontmatter.id === rows[0].uuid);
      const doc = tree.find((block) => block.frontmatter.id === rows[1].uuid);
      const spec = tree.find((block) => block.frontmatter.id === rows[2].uuid);
      expect(root?.body).toBe(rows[0].body);
      expect(doc?.parentId).toBe(rows[0].uuid);
      expect(doc?.frontmatter.sources).toEqual([
        { kind: 'file', ref: 'src/db/Store.ts' },
        { kind: 'symbol', ref: 'src/db/Store.ts', symbol: 'Store' },
      ]);
      expect(spec?.frontmatter.fields).toEqual(rows[2].fields);
      expect(spec?.frontmatter.edges).toEqual([
        { kind: 'implements', to: rows[1].uuid },
        { kind: 'relates', to: rows[3].uuid },
      ]);
      const fs = yield* FileSystem.FileSystem;
      const path = yield* fs.makeTempDirectoryScoped({ prefix: 'export-' });
      yield* writeBlockTree(path, tree);
      const scan = yield* scanTree(path);
      expect(new Map(scan.blocks.map(({ path: _path, ...row }) => [row.frontmatter.id, row]))).toEqual(
        new Map(tree.map((row) => [row.frontmatter.id, row])),
      );
    }),
  );

  it.effect('a survivor under a trashed parent refuses naming both ends', () =>
    Effect.gen(function* () {
      const broken = [
        { ...rows[3], id: 7 },
        { ...rows[1], id: 8, parentId: 7 },
      ];
      const error = yield* Effect.flip(exportGraphRows(broken, { edges: new Map(), sources: new Map(), sessions: new Map() }));
      expect(error).toBeInstanceOf(ExportFailed);
      expect(error.message).toMatch(/\b8\b/);
      expect(error.message).toMatch(/\b7\b/);
    }),
  );
});
