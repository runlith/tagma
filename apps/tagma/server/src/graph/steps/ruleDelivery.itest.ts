import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { ruleDelivery } from './ruleDelivery.js';
import { anchorsOf } from '../contract/wire/sources.js';

layer(demoGraphLayer(), { excludeTestServices: true })('rule delivery step', (it) => {
  it.effect(
    'a rule that took its reach from a module gets that territory as sources, an enforced symbol-only rule keeps the whole project, and no other rule moves',
    () =>
      withDemo(({ graph, projectId, demoRoot }) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            for (const dir of ['srv/graph', 'kit']) {
              await mkdir(join(demoRoot, dir), { recursive: true });
              await writeFile(join(demoRoot, dir, 'a.ts'), 'export const read = () => 1;\n');
            }
          });
          const root = (yield* graph.blocks.rootBlockOf(projectId)).id;
          const [server] = yield* graph.blocks.writeModules(projectId, [{ id: 'server', title: 'server', parent: root, root: 'srv' }], []);
          const [inner] = yield* graph.blocks.writeModules(
            projectId,
            [{ id: 'graph', title: 'graph', parent: server!, root: 'srv/graph' }],
            [],
          );
          yield* graph.blocks.writeModules(projectId, [{ id: 'kit', title: 'kit', parent: root, root: 'kit' }], []);
          const rule = (title: string, parentId: number, sources?: readonly { kind: 'dir' | 'symbol'; ref: string; symbol?: string }[]) =>
            Effect.map(graph.blocks.create({ projectId, tags: ['rule'], title, parentId, sources }), (row) => row.id);
          const inherited = yield* rule('Server law', server!);
          const symbolOnly = yield* rule('Graph law', inner!, [{ kind: 'symbol', ref: 'srv/graph/a.ts', symbol: 'read' }]);
          const own = yield* rule('Own law', server!, [{ kind: 'dir', ref: 'srv/own' }]);
          const outside = yield* rule('Project law', root);
          const measuredWhole = yield* rule('Measured law', root, [{ kind: 'symbol', ref: 'kit/a.ts', symbol: 'read' }]);
          yield* graph.blocks.setEnforcement({
            id: measuredWhole,
            anchors: anchorsOf(yield* graph.sources.of(measuredWhole)),
            stood: undefined,
            document: {
              strictness: 'note',
              on: [],
              inspection: 'reexports',
              debt: [],
              escaped: [],
            },
            journal: {},
          });
          const project = yield* graph.projects.byId(projectId);
          yield* ruleDelivery(project);
          yield* ruleDelivery(project);
          const refs = (id: number) => Effect.map(graph.sources.of(id), (rows) => rows.map((row) => row.ref).sort());
          expect(yield* refs(inherited)).toEqual(['srv']);
          expect(yield* refs(symbolOnly)).toEqual(['srv/graph', 'srv/graph/a.ts'].sort());
          expect(yield* refs(own)).toEqual(['srv/own']);
          expect(yield* refs(outside)).toEqual([]);
          expect(yield* refs(measuredWhole)).toEqual(['.', 'kit/a.ts']);
        }),
      ),
  );
});
