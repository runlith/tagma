import { Effect, FileSystem, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { type AmendmentOp } from '../../contract/wire/batch.js';
import { blockName } from '../../contract/wire/references.js';
import { CallerAim } from '../../../platform/contract/service/place.js';
import { CallerCheckout } from '../../../workspace/contract/service/checkouts.js';
import { MeasuredCheckout } from '../../contract/service/serving.js';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../../composition/testing/graphFixture.js';

const lens = (demo: EffectDemo) => {
  const { graph, projectId, nameOf } = demo;
  const held = (id: number) => Effect.map(nameOf(id), (name) => ({ id, name }));
  const create = (tag: string, title: string, extra: { body?: string } = {}) =>
    Effect.flatMap(graph.blocks.create({ projectId, tags: [tag], title, ...extra }), (row) => held(row.id));
  const proposing = (amendsId: number, ops: AmendmentOp[], title = 'amendment') =>
    graph.review.propose({ projectId, title, amendsId, ops });
  const propose = (amendsId: number, ops: AmendmentOp[], title = 'amendment') =>
    Effect.flatMap(proposing(amendsId, ops, title), (row) => held(row.id));
  return { ...demo, create, proposing, propose };
};

const withLens = <A, E, R>(body: (given: ReturnType<typeof lens>) => Effect.Effect<A, E, R>) => withDemo((demo) => body(lens(demo)));

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('proposal filing', (it) => {
  it.effect('a proposal is born under its target with the amends edge, and the edge is operation-only in both directions', () =>
    withLens(({ graph, create, propose, proposing, refusal, table }) =>
      Effect.gen(function* () {
        const target = yield* create('spec', 'under review');
        const proposal = yield* propose(target.id, [{ op: 'edit', id: target.name, old: 'x', new: 'y' }]);
        const view = yield* graph.reading.show(proposal.id, 0);
        expect(view.parentId).toBe(target.id);
        expect((yield* table()).statusOf(view)).toBe('open');
        expect(view.edgesOut.some((e) => e.kind === 'amends' && blockName(e.toUuid ?? '') === target.name)).toBe(true);
        const amending = yield* refusal(proposing(proposal.id, [{ op: 'edit', id: proposal.name, old: 'x', new: 'y' }]));
        expect(amending.code).toBe('amends-an-amendment');
        expect((yield* refusal(graph.edges.link({ fromId: proposal.id, kind: 'amends', toId: target.id }))).code).toBe('operation-only');
        expect((yield* refusal(graph.edges.unlink({ fromId: proposal.id, kind: 'amends', toId: target.id }))).code).toBe('operation-only');
      }),
    ),
  );

  it.effect('an op aiming outside the amended subtree refuses at propose', () =>
    withLens(({ create, proposing, refusal }) =>
      Effect.gen(function* () {
        const target = yield* create('spec', 'narrow');
        const outside = yield* create('spec', 'elsewhere');
        const code = (ops: AmendmentOp[]) => Effect.map(refusal(proposing(target.id, ops)), (refused) => refused.code);
        expect(yield* code([{ op: 'edit', id: outside.name, old: 'x', new: 'y' }])).toBe('amendment-outside');
        expect(yield* code([{ op: 'create', tags: ['idea'], title: 'stray' }])).toBe('amendment-outside');
        expect(
          yield* code([
            {
              op: 'create',
              tags: ['idea'],
              title: 'outside relation',
              parentId: target.name,
              edges: [{ kind: 'relates', to: outside.name }],
            },
          ]),
        ).toBe('amendment-outside');
        expect(yield* code([{ op: 'edit', id: '$ghost', old: 'x', new: 'y' } as never])).toBe('amendment-ref');
      }),
    ),
  );

  it.effect('a proposal moves the block it amends to any destination, and a move filed on the destination names the block to amend', () =>
    withLens(({ graph, create, propose, proposing, refusal, table }) =>
      Effect.gen(function* () {
        const moved = yield* create('idea', 'parked', { body: 'text' });
        const home = yield* create('zone', 'its owner');
        const refused = yield* refusal(proposing(home.id, [{ op: 'update', id: moved.name, parentId: home.name }]));
        expect(refused.code).toBe('amendment-outside');
        expect(refused.unblock[0]).toContain(moved.name);
        const proposal = yield* propose(moved.id, [{ op: 'update', id: moved.name, parentId: home.name }]);
        expect(yield* graph.review.obstacles(proposal.id)).toEqual([]);
        expect((yield* table()).statusOf(yield* graph.review.accept({ id: proposal.id }))).toBe('applied');
        expect((yield* graph.blocks.blockById(moved.id)).parentId).toBe(home.id);
      }),
    ),
  );

  it.effect('a view named as a destination refuses when the finding is filed', () =>
    withLens(({ graph, projectId, create, nameOf, proposing, refusal }) =>
      Effect.gen(function* () {
        const moved = yield* create('idea', 'parked', { body: 'text' });
        const saved = yield* graph.blocks.create({
          projectId,
          tags: ['view'],
          title: 'a page',
          fields: { query: { tags: ['task'], sort: { by: 'created', order: 'asc' } } },
        });
        const savedName = yield* nameOf(saved.id);
        expect((yield* refusal(proposing(moved.id, [{ op: 'update', id: moved.name, parentId: savedName }]))).code).toBe('leaf');
        expect((yield* refusal(proposing(moved.id, [{ op: 'update', id: moved.name, parentId: 'a1b2c3d4' }]))).code).toBe('not-found');
      }),
    ),
  );

  it.effect("a deferred body past its tag cap refuses at filing with the write gate's own refusal", () =>
    withLens(({ graph, projectId, create, propose, refusal }) =>
      Effect.gen(function* () {
        const target = yield* create('spec', 'capped');
        const cap = 32;
        yield* graph.blocks.create({
          projectId,
          tags: ['tag'],
          title: '#bounded',
          fields: { id: 'bounded', body: { shape: 'content', cap } },
        });
        const past = 'x'.repeat(cap + 1);
        const standing = yield* graph.blocks.create({ projectId, tags: ['bounded'], title: 'the standing law', body: 'MUST be short.' });
        const direct = yield* refusal(graph.blocks.update({ id: standing.id, body: past }));
        const refused = yield* refusal(
          graph.review.propose({
            projectId,
            amendsId: target.id,
            title: 'a law past its cap',
            ops: [{ op: 'create', tags: ['bounded'], parentId: target.name, title: 'bounded data', body: past }],
          }),
        );
        expect(direct.code).toBe('body-capped');
        expect(refused.code).toBe('body-capped');
        expect(refused.reason).toBe(direct.reason);
        expect(refused.unblock).toEqual(direct.unblock);
        yield* propose(target.id, [
          { op: 'create', tags: ['bounded'], parentId: target.name, title: 'bounded data', body: 'MUST be short.' },
        ]);
      }),
    ),
  );

  it.effect('revise rewrites an open payload through the filing gates and refuses elsewhere', () =>
    withLens(({ graph, create, propose, refusal }) =>
      Effect.gen(function* () {
        const target = yield* create('spec', 'revisable');
        const proposal = yield* propose(target.id, [{ op: 'edit', id: target.name, old: 'x', new: 'y' }]);
        yield* graph.review.revise({
          id: proposal.id,
          ops: [{ op: 'create', tags: ['idea'], parentId: target.name, title: 'grown', body: 'measured' }],
        });
        const outside = yield* create('spec', 'elsewhere');
        const revise = (id: number, name: string) =>
          Effect.map(refusal(graph.review.revise({ id, ops: [{ op: 'edit', id: name, old: 'x', new: 'y' }] })), (refused) => refused.code);
        expect(yield* revise(proposal.id, outside.name)).toBe('amendment-outside');
        expect(yield* revise(target.id, target.name)).toBe('not-an-amendment');
        yield* graph.review.reject({ id: proposal.id, reason: 'declined' });
        expect(yield* revise(proposal.id, target.name)).toBe('verdict-standing');
      }),
    ),
  );

  it.effect('proposal sources belong to the measured checkout, including when the block is created directly', () =>
    withLens(({ graph, projectId, create, refusal }) =>
      Effect.gen(function* () {
        const target = yield* create('spec', 'owns the code');
        const project = yield* graph.projects.byId(projectId);
        const other = join(project.rootPath, 'another-checkout');
        const ops: AmendmentOp[] = [{ op: 'update', id: target.name, title: 'corrected owner' }];
        const filed = (cwd: string, sources = true) =>
          graph.blocks
            .create({
              projectId,
              tags: ['proposal'],
              title: 'correct the owner',
              amendsId: target.id,
              fields: { ops },
              sources: sources ? [{ kind: 'file', ref: 'owner.ts' }] : undefined,
            })
            .pipe(
              Effect.provideService(CallerAim, { project: undefined, cwd, branch: undefined }),
              Effect.provideService(CallerCheckout, {
                cwd,
                repo: Effect.succeed({
                  key: project.repoKey,
                  path: cwd,
                  toplevel: cwd,
                  gitDir: join(project.rootPath, '.git'),
                  mainWorktree: project.rootPath,
                }),
              }),
              Effect.provideService(MeasuredCheckout, { projectId, path: project.rootPath }),
            );
        expect((yield* refusal(filed(other))).code).toBe('tree-not-measured');
        expect(yield* graph.blocks.childrenOf(target.id)).toEqual([]);
        const measured = yield* filed(project.rootPath);
        expect((yield* graph.sources.of(measured.id)).map((source) => source.ref)).toEqual(['owner.ts']);
        const text = yield* filed(other, false);
        expect((yield* graph.blocks.blockById(text.id)).parentId).toBe(target.id);
      }),
    ),
  );

  it.effect('a proposal is born with its sources, and no other tag carries amends or ops', () =>
    withLens(({ graph, projectId, demoRoot, create, refusal }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(join(demoRoot, 'owner.ts'), 'export const owner = 1;\n');
        const target = yield* create('spec', 'owns the code');
        const { id } = yield* graph.review.propose({
          projectId,
          title: 'the owner is wrong',
          amendsId: target.id,
          ops: [{ op: 'create', tags: ['task'], title: 'fix the owner', parentId: target.name }],
          sources: [{ kind: 'symbol', ref: 'owner.ts', symbol: 'owner' }],
        });
        expect((yield* graph.sources.of(id))[0]?.symbol).toBe('owner');
        yield* graph.sources.attach({ blockId: id, kind: 'file', ref: 'owner.ts' });
        expect((yield* graph.sources.of(id)).map((row) => row.kind).sort()).toEqual(['file', 'symbol']);
        const half = yield* refusal(
          graph.review.propose({
            projectId,
            title: 'half evidence',
            amendsId: target.id,
            ops: [{ op: 'edit', id: target.name, old: 'x', new: 'y' }],
            sources: [{ kind: 'symbol', ref: 'owner.ts' }],
          }),
        );
        expect(half.code).toBe('symbol-shape');
        expect((yield* graph.blocks.childrenOf(target.id)).map((c) => c.title)).not.toContain('half evidence');
      }),
    ),
  );
});
