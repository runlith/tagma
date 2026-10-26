import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { fixtureGraphMigrations } from '../../composition/testing/migrations.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { Blocks } from '../contract/service/blocks.js';
import { FORMAT_FILE } from '../contract/wire/storage.js';
import { readBlockTree, writeBlockTree } from '../tree/layout.js';
import { projectToTree } from '../tree/projection.js';
import { markerText, readMarker } from '../tree/marker.js';
import { graphPool } from '../testing/doubles.js';
import { shippedSteps } from './sequence.js';

const CARD = '0199cccc-0000-7000-8000-00000000b002';
const LAW = '0199cccc-0000-7000-8000-00000000b003';
const FLOORS = '0199cccc-0000-7000-8000-00000000b004';
const OTHER_FLOORS = '0199cccc-0000-7000-8000-00000000b005';

layer(demoGraphLayer({ repos: ['modules'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'legacy module graphs',
  (it) => {
    it.effect('opening a foreign graph migrates its own module map and preserves authored cards and law', () =>
      withDemo(({ graph, context, project, demoRoot }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const home = project('modules');
          yield* graph.projectPolicy.setStorage({ id: home.id, mode: 'team' });
          yield* fs.makeDirectory(join(home.root, 'lib/reader/a/wire'), { recursive: true });
          yield* fs.makeDirectory(join(home.root, 'lib/reader/b/wire'), { recursive: true });
          yield* fs.makeDirectory(join(home.root, 'lib/reader/store'), { recursive: true });
          const treeRoot = join(home.root, '.tagma');
          const root = yield* graph.blocks.rootBlockOf(home.id);
          yield* projectToTree({ projectId: home.id, treeRoot });
          yield* writeBlockTree(treeRoot, [
            ...(yield* readBlockTree(treeRoot)),
            {
              parentId: root.uuid,
              frontmatter: {
                id: CARD,
                title: 'Authored reader',
                ord: 1,
                tags: ['module'],
                fields: { kind: 'product' },
                sources: [{ kind: 'dir', ref: 'lib/reader' }],
              },
              body: 'Knowledge from this project.',
            },
            {
              parentId: root.uuid,
              frontmatter: {
                id: LAW,
                title: 'Our import law',
                ord: 2,
                tags: ['rule'],
                fields: {
                  enforcement: {
                    strictness: 'gate',
                    on: [{ op: 'submit_work', phase: 'before' }],
                    debt: [],
                    escaped: [],
                    checks: [
                      {
                        builtin: 'modules',
                        params: {
                          base: '.',
                          modules: [
                            { id: 'reader', territory: ['lib/reader/'], entries: [{ at: 'lib/reader/', for: ['store'] }] },
                            { id: 'store', territory: ['lib/reader/store/'], entries: [{ at: 'lib/reader/store/' }] },
                          ],
                          relations: [{ from: 'reader', to: 'store', role: 'testing' }],
                        },
                      },
                    ],
                  },
                },
              },
              body: 'The law this project wrote.',
            },
            {
              parentId: root.uuid,
              frontmatter: {
                id: FLOORS,
                title: 'Reader floors',
                ord: 3,
                tags: ['rule'],
                fields: {
                  enforcement: { checks: [{ builtin: 'direction', params: { base: 'lib/reader/a', floors: [['wire/'], ['.']] } }] },
                },
              },
              body: '',
            },
            {
              parentId: root.uuid,
              frontmatter: {
                id: OTHER_FLOORS,
                title: 'Independent reader floors',
                ord: 4,
                tags: ['rule'],
                fields: {
                  enforcement: { checks: [{ builtin: 'direction', params: { base: 'lib/reader/b', floors: [['wire/'], ['.']] } }] },
                },
              },
              body: '',
            },
          ]);
          yield* fs.writeFileString(join(treeRoot, FORMAT_FILE), markerText('claims-leave'));
          const pool = yield* Effect.acquireRelease(
            graphPool({ machine: context, sourcePath: demoRoot, identity: testSessionIdentity, migrations: fixtureGraphMigrations }),
            (held) => held.dispose(),
          );
          const legacy = yield* readBlockTree(treeRoot);
          const refused = yield* Effect.result(pool.resolve({ projectId: home.id, cwd: home.root }));
          expect(refused._tag).toBe('Failure');
          if (refused._tag === 'Failure') expect(refused.failure.code).toBe('vocabulary-older');
          expect(yield* readBlockTree(treeRoot)).toEqual(legacy);
          expect(yield* readMarker(join(treeRoot, FORMAT_FILE))).toEqual({ kind: 'read', step: 'claims-leave' });
          yield* fs.remove(join(treeRoot, legacy.find((row) => row.frontmatter.id === OTHER_FLOORS)!.path));
          const opened = yield* pool.resolve({ projectId: home.id, cwd: home.root });
          const blocks = Context.get(opened.context, Blocks);
          const cards = yield* blocks.moduleCards(home.id);
          expect(cards.map((card) => card.id).sort()).toEqual(['reader', 'store']);
          expect(cards.map((card) => card.parent)).toEqual([null, null]);
          const reader = cards.find((card) => card.id === 'reader')!;
          const store = cards.find((card) => card.id === 'store')!;
          expect(reader).toMatchObject({
            title: 'Authored reader',
            roots: ['lib/reader'],
            order: [['a/wire/'], ['a/']],
            importsTests: [store.block],
          });
          expect(reader.entries).toEqual([{ at: '.', for: [store.name] }]);
          expect(yield* blocks.rawBlockById(reader.block)).toMatchObject({
            uuid: CARD,
            body: 'Knowledge from this project.',
            fields: { kind: 'product' },
          });
          expect(yield* blocks.rawBlockById(store.block)).toMatchObject({
            title: 'store',
            body: '',
            fields: { id: 'store', entries: [{ at: '.' }] },
          });
          expect((yield* blocks.rawBlockById(store.block)).fields.kind).toBeUndefined();
          const law = yield* blocks.childrenOf((yield* blocks.rootBlockOf(home.id)).id);
          expect(law.find((row) => row.uuid === LAW)?.body).toBe('The law this project wrote.');
          expect(yield* readMarker(join(treeRoot, FORMAT_FILE))).toEqual({ kind: 'read', step: shippedSteps.last });
        }),
      ),
    );
  },
);
