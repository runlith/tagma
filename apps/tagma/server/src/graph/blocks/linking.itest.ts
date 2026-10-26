import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';

const declaring = (root: string, path: string, text: string) => Effect.promise(() => writeFile(join(root, path), text));

layer(demoGraphLayer(), { excludeTestServices: true })('block relations', (it) => {
  it.effect('ready excludes blocked tasks and releases them when the blocker ends either way', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const a = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'a' });
        const b = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'b' });
        const ready = Effect.map(graph.selection.ready({ projectId }), (rows) => rows.map((row) => row.id));
        yield* graph.edges.link({ fromId: b.id, kind: 'waits-on', toId: a.id });
        expect(yield* ready).toEqual([a.id]);
        expect((yield* graph.reading.show(b.id, 0)).blocked).toBe(true);
        expect((yield* graph.reading.show(a.id, 0)).blocked).toBe(false);
        yield* graph.tasks.claim({ id: a.id });
        yield* graph.tasks.finish({ id: a.id });
        expect(yield* ready).toEqual([b.id]);
        const c = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'c' });
        yield* graph.edges.link({ fromId: b.id, kind: 'waits-on', toId: c.id });
        expect(yield* ready).toEqual([c.id]);
        yield* graph.tasks.close({ id: c.id });
        expect(yield* ready).toEqual([b.id]);
      }),
    ),
  );

  it.effect('dependency cycles and non-work blockers are rejected at write', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const a = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'a' });
        const b = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'b' });
        const c = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'c' });
        yield* graph.edges.link({ fromId: b.id, kind: 'waits-on', toId: a.id });
        yield* graph.edges.link({ fromId: c.id, kind: 'waits-on', toId: b.id });
        expect((yield* refusal(graph.edges.link({ fromId: a.id, kind: 'waits-on', toId: c.id }))).code).toBe('wait-cycle');
        const spec = yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'spec' });
        expect((yield* refusal(graph.edges.link({ fromId: a.id, kind: 'waits-on', toId: spec.id }))).code).toBe('edge-shape');
      }),
    ),
  );

  it.effect('a declared work type is born with its relations atomically and repeated edges occupy one row', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        yield* graph.blocks.create({ projectId, tags: ['tag'], title: '#chore', fields: { id: 'chore', extends: 'task' } });
        const { id: origin } = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'origin' });
        const born = yield* graph.blocks.create({
          projectId,
          tags: ['chore'],
          title: 'three relations',
          edges: [
            { kind: 'relates', to: origin },
            { kind: 'waits-on', to: origin },
            { kind: 'discovered-from', to: origin },
            { kind: 'relates', to: origin },
          ],
        });
        const page = yield* graph.reading.show(born.id, 0);
        expect(page.edgesOut.map((edge) => [edge.kind, edge.toId]).sort()).toEqual([
          ['discovered-from', origin],
          ['relates', origin],
          ['waits-on', origin],
        ]);
        expect(page.blocked).toBe(true);
        const refused = yield* refusal(
          graph.blocks.create({
            projectId,
            tags: ['chore'],
            title: 'refused relations',
            parentId: origin,
            edges: [
              { kind: 'relates', to: origin },
              { kind: 'unknown-edge', to: origin },
            ],
          }),
        );
        expect(refused.code).toBe('edge-undeclared');
        expect(yield* graph.blocks.childrenOf(origin)).toEqual([]);
      }),
    ),
  );

  it.effect('discovery belongs to an untagged node at birth, link and unlink', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const { id: origin } = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'origin' });
        const born = yield* graph.blocks.create({ projectId, title: 'found', edges: [{ kind: 'discovered-from', to: origin }] });
        expect((yield* graph.reading.show(born.id, 0)).edgesOut.map((edge) => [edge.kind, edge.toId])).toEqual([
          ['discovered-from', origin],
        ]);
        yield* graph.edges.unlink({ fromId: born.id, kind: 'discovered-from', toId: origin });
        expect((yield* graph.reading.show(born.id, 0)).edgesOut).toEqual([]);
        yield* graph.edges.link({ fromId: born.id, kind: 'discovered-from', toId: origin });
        expect((yield* graph.reading.show(born.id, 0)).edgesOut.map((edge) => edge.toId)).toEqual([origin]);
      }),
    ),
  );

  it.effect('an edge with behaviour meaning requires its contract when the tag is declared', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const refused = yield* refusal(
          graph.blocks.create({ projectId, tags: ['tag'], title: '#waiting', fields: { id: 'waiting', edges: ['waits-on'] } }),
        );
        expect(refused.code).toBe('tag-incoherent');
      }),
    ),
  );

  it.effect('implementation connects work to a standing spec and projects its active work', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const target = yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'spec' });
        const builder = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'task' });
        yield* graph.edges.link({ fromId: builder.id, kind: 'implements', toId: target.id });
        yield* graph.tasks.claim({ id: builder.id });
        expect((yield* graph.reading.show(target.id, 0)).building).toBe(true);
        const nonSpec = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'non-spec' });
        expect((yield* refusal(graph.edges.link({ fromId: builder.id, kind: 'implements', toId: nonSpec.id }))).code).toBe('edge-shape');
        const successor = yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'successor' });
        yield* graph.standing.supersede({ oldId: target.id, withId: successor.id });
        expect((yield* refusal(graph.edges.link({ fromId: nonSpec.id, kind: 'implements', toId: target.id }))).code).toBe('superseded');
      }),
    ),
  );

  it.effect('the supersedes edge cannot be unlinked; a missing edge refuses instead of lying', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const oldSpec = yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'old' });
        const newSpec = yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'new' });
        yield* graph.standing.supersede({ oldId: oldSpec.id, withId: newSpec.id });
        expect((yield* refusal(graph.edges.unlink({ fromId: newSpec.id, kind: 'supersedes', toId: oldSpec.id }))).code).toBe(
          'operation-only',
        );
        const a = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'a' });
        const b = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'b' });
        expect((yield* refusal(graph.edges.unlink({ fromId: a.id, kind: 'relates', toId: b.id }))).code).toBe('no-edge');
      }),
    ),
  );

  it.effect('a project-declared edge is allowed only from a node whose tags declare it', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        yield* graph.blocks.create({
          projectId,
          tags: ['tag'],
          title: '#meeting',
          body: 'A meeting record.',
          fields: { id: 'meeting', edges: ['reviews'] },
        });
        const meeting = yield* graph.blocks.create({ projectId, tags: ['task', 'meeting'], title: 'meeting work' });
        const reviewed = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'reviewed' });
        yield* graph.edges.link({ fromId: meeting.id, kind: 'reviews', toId: reviewed.id });
        expect((yield* graph.reading.show(meeting.id, 0)).edgesOut.map((row) => row.kind)).toEqual(['reviews']);
        const fromTask = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'from task' });
        const undeclared = yield* refusal(graph.edges.link({ fromId: fromTask.id, kind: 'reviews', toId: reviewed.id }));
        expect(undeclared.code).toBe('edge-undeclared');
        expect(undeclared.reason).toContain('reviews');
        expect((yield* refusal(graph.edges.link({ fromId: meeting.id, kind: 'supersedes', toId: reviewed.id }))).code).toBe(
          'operation-only',
        );
      }),
    ),
  );

  it.effect('an edge declared with targets points only at nodes carrying one of them', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        for (const [id, edges] of [
          ['ingredient', []],
          ['recipe', [{ kind: 'uses', to: ['ingredient'] }]],
        ] as const) {
          yield* graph.blocks.create({ projectId, tags: ['tag'], title: `#${id}`, body: id, fields: { id, edges } });
        }
        const recipe = yield* graph.blocks.create({ projectId, tags: ['recipe'], title: 'carbonara' });
        const egg = yield* graph.blocks.create({ projectId, tags: ['ingredient'], title: 'egg' });
        yield* graph.edges.link({ fromId: recipe.id, kind: 'uses', toId: egg.id });
        const task = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'not food' });
        expect((yield* refusal(graph.edges.link({ fromId: recipe.id, kind: 'uses', toId: task.id }))).code).toBe('edge-shape');
      }),
    ),
  );

  it.effect('a source is taken off by its whole identity, and its neighbours stay', () =>
    withDemo(({ graph, projectId, demoRoot, refusal }) =>
      Effect.gen(function* () {
        yield* declaring(demoRoot, 'gate.ts', 'export class Gate {}\n');
        const { id } = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'a' });
        yield* graph.sources.attach({ blockId: id, kind: 'file', ref: 'gate.ts' });
        yield* graph.sources.attach({ blockId: id, kind: 'symbol', ref: 'gate.ts', symbol: 'Gate' });
        yield* graph.sources.unanchor({ blockId: id, kind: 'file', ref: 'gate.ts' });
        expect((yield* graph.sources.of(id)).map((anchor) => `${anchor.kind}:${anchor.symbol ?? ''}`)).toEqual(['symbol:Gate']);
        yield* graph.sources.unanchor({ blockId: id, kind: 'symbol', ref: 'gate.ts', symbol: 'Gate' });
        expect(yield* graph.sources.of(id)).toEqual([]);
        expect((yield* refusal(graph.sources.unanchor({ blockId: id, kind: 'file', ref: 'gate.ts' }))).code).toBe('no-source');
      }),
    ),
  );

  it.effect('the same source twice is refused', () =>
    withDemo(({ graph, projectId, demoRoot, refusal }) =>
      Effect.gen(function* () {
        yield* declaring(demoRoot, 'gate.ts', 'export class Gate {}\n');
        const { id } = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'a' });
        yield* graph.sources.attach({ blockId: id, kind: 'file', ref: 'gate.ts' });
        expect((yield* refusal(graph.sources.attach({ blockId: id, kind: 'file', ref: 'gate.ts' }))).code).toBe('duplicate-source');
        expect((yield* graph.sources.attach({ blockId: id, kind: 'symbol', ref: 'gate.ts', symbol: 'Gate' })).kind).toBe('symbol');
      }),
    ),
  );

  it.effect('taking a source off drops its path from the search projection', () =>
    withDemo(({ graph, projectId, nameOf }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'задача без пути в заголовке' });
        const name = yield* nameOf(id);
        yield* graph.sources.attach({ blockId: id, kind: 'file', ref: 'src/lonely/Owner.ts' });
        expect((yield* graph.ranking.search({ query: 'src/lonely/Owner.ts', projectId })).items.map((row) => row.name)).toContain(name);
        yield* graph.sources.unanchor({ blockId: id, kind: 'file', ref: 'src/lonely/Owner.ts' });
        expect((yield* graph.ranking.search({ query: 'src/lonely/Owner.ts', projectId })).items.map((row) => row.name)).not.toContain(name);
      }),
    ),
  );

  it.effect('a symbol source names a symbol its file declares, and no other kind carries one', () =>
    withDemo(({ graph, projectId, demoRoot, refusal }) =>
      Effect.gen(function* () {
        yield* declaring(demoRoot, 'x.ts', 'export const X = 1;\n');
        const { id } = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'a' });
        expect((yield* refusal(graph.sources.attach({ blockId: id, kind: 'symbol', ref: 'x.ts' }))).code).toBe('symbol-shape');
        expect((yield* refusal(graph.sources.attach({ blockId: id, kind: 'file', ref: 'x.ts', symbol: 'X' }))).code).toBe('symbol-shape');
        expect((yield* refusal(graph.sources.attach({ blockId: id, kind: 'symbol', ref: 'x.ts', symbol: 'Y' }))).code).toBe(
          'symbol-missing',
        );
        expect((yield* refusal(graph.sources.attach({ blockId: id, kind: 'symbol', ref: 'gone.ts', symbol: 'X' }))).code).toBe(
          'symbol-missing',
        );
        expect(yield* graph.sources.of(id)).toEqual([]);
        expect((yield* graph.sources.attach({ blockId: id, kind: 'symbol', ref: 'x.ts', symbol: 'X' })).symbol).toBe('X');
      }),
    ),
  );

  it.effect('provenance edges of create face the same legality as link', () =>
    withDemo(({ graph, projectId, fixture, refusal }) =>
      Effect.gen(function* () {
        const idea = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'не спека' });
        expect(
          (yield* refusal(
            graph.blocks.create({ projectId, tags: ['task'], title: 'кривое происхождение', edges: [{ kind: 'implements', to: idea.id }] }),
          )).code,
        ).toBe('edge-shape');
        expect((yield* graph.ranking.search({ query: 'происхождение', projectId })).items).toEqual([]);
        const foreign = yield* graph.projectLifecycle.create({ name: 'neighbour', rootPath: yield* fixture.directory('neighbour') });
        const foreignSpec = yield* graph.blocks.create({ projectId: foreign.id, tags: ['spec'], title: 'чужая' });
        const born = yield* graph.blocks.create({
          projectId,
          tags: ['task'],
          title: 'чужое происхождение',
          edges: [{ kind: 'discovered-from', to: foreignSpec.id }],
        });
        expect((yield* graph.edges.farOf(projectId)).filter((row) => row.fromId === born.id)).toEqual([
          expect.objectContaining({ kind: 'discovered-from', uuid: foreignSpec.uuid }),
        ]);
      }),
    ),
  );

  it.effect('a read hides an edge whose far end is in the trash, and unlink cuts it without a restore', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const spec = yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'the decision' });
        const task = yield* graph.blocks.create({
          projectId,
          tags: ['task'],
          title: 'the work',
          edges: [{ kind: 'implements', to: spec.id }],
        });
        expect((yield* graph.reading.show(spec.id, 0)).edgesIn.map((row) => row.fromId)).toEqual([task.id]);
        yield* graph.trash.delete({ id: task.id });
        expect((yield* graph.reading.show(spec.id, 0)).edgesIn).toEqual([]);
        yield* graph.edges.unlink({ fromId: task.id, kind: 'implements', toId: spec.id });
        yield* graph.trash.restore({ id: task.id });
        expect((yield* graph.reading.show(spec.id, 0)).edgesIn).toEqual([]);
      }),
    ),
  );
});
