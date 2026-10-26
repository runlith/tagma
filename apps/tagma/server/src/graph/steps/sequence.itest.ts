import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import { type EffectDemo, demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { block, blockTag } from '../store/tables.js';
import { mintBlockId } from '../contract/wire/identity.js';
import { blockName } from '../contract/wire/references.js';
import { shippedTypeId } from '../contract/wire/tags/identity.js';
import { SPEC } from '../contract/wire/tags/spec.js';
import { claimsLeave } from './claimsLeave.js';
import { decisionBecomesSpec } from './decisionBecomesSpec.js';
import { measurementsLeave } from './measurementsLeave.js';
import { ruleInspections } from './ruleInspections.js';
import { type LawEnforcement, lawEnforcementSchema } from '../contract/wire/enforcement.js';
import { closedParsing } from '../contract/wire/fields.js';
import { provenanceLeaves } from './provenanceLeaves.js';
import { creationEdges } from './creationEdges.js';

type Raw = Record<string, unknown>;

const create = (demo: EffectDemo, input: Parameters<EffectDemo['graph']['blocks']['create']>[0]) =>
  Effect.map(demo.graph.blocks.create(input), (row) => row.id);

const rows = ({ graph, projectId }: EffectDemo) =>
  graph.graphStore.db.select().from(block).where(eq(block.projectId, projectId)).orderBy(block.id);

const declarationOf = (demo: EffectDemo, id: string) =>
  Effect.map(rows(demo), (rows) => rows.find((row) => row.deletedAt === null && row.tags.includes('tag') && row.fields.id === id));

const renamed = (value: unknown, from: string, to: string): unknown => JSON.parse(JSON.stringify(value).replaceAll(`"${from}"`, `"${to}"`));

const LIBRARY = 'code-project';

const retire = Effect.fnUntraced(function* (demo: EffectDemo) {
  const { graph, projectId } = demo;
  for (const row of yield* rows(demo)) {
    const vocabulary = row.tags.includes('tag') || row.tags.includes('catalog');
    const stored = vocabulary ? (JSON.parse(JSON.stringify(row.fields).replaceAll('software-development', LIBRARY)) as Raw) : row.fields;
    const declares = row.tags.includes('tag') && stored.id === 'spec';
    const lists = row.tags.includes('catalog') && stored.id === LIBRARY;
    if (!vocabulary && !row.tags.includes('spec')) continue;
    const fields =
      declares || lists
        ? (renamed(renamed(stored, 'spec', 'decision'), shippedTypeId(LIBRARY, 'spec'), shippedTypeId(LIBRARY, 'decision')) as Raw)
        : stored;
    yield* graph.graphStore.db
      .update(block)
      .set({ tags: row.tags.map((tag) => (tag === 'spec' ? 'decision' : tag)), fields, title: declares ? '#decision' : row.title })
      .where(eq(block.id, row.id));
  }
  yield* graph.tags.forget(projectId);
});

layer(demoGraphLayer(), { excludeTestServices: true })('graph steps', (it) => {
  it.effect('decisions become specs, filed divergences and their descendants leave, and repeating the step preserves rows', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const hub = yield* create(demo, { projectId, tags: ['spec'], title: 'the hub' });
        const part = yield* create(demo, { projectId, tags: ['spec'], title: 'a part of it', parentId: hub });
        const builder = yield* create(demo, { projectId, tags: ['task'], title: 'build it', edges: [{ kind: 'implements', to: hub }] });
        const delta = yield* create(demo, {
          projectId,
          tags: ['spec'],
          title: 'reality disagreed',
          parentId: hub,
          edges: [{ kind: 'discovered-from', to: builder }],
        });
        yield* graph.edges.link({ fromId: builder, kind: 'implements', toId: delta });
        const under = yield* create(demo, { projectId, tags: ['task'], title: 'under the divergence', parentId: delta });
        yield* retire(demo);
        const project = yield* graph.projects.byId(projectId);
        yield* decisionBecomesSpec(project);
        yield* graph.tags.forget(projectId);
        const once = yield* rows(demo);
        yield* decisionBecomesSpec(project);
        expect(yield* rows(demo)).toEqual(once);
        const table = yield* demo.table();
        for (const id of [hub, part]) {
          const spec = yield* graph.blocks.blockById(id);
          expect(spec.tags).toEqual(['spec']);
          expect(table.supports(spec, SPEC)).toBe(true);
        }
        expect(table.unreadable).toEqual([]);
        for (const id of [delta, under]) expect((yield* graph.blocks.rawBlockById(id)).deletedAt).toBeInstanceOf(Date);
      }),
    ),
  );

  it.effect('a duplicate shipped spec gives way to the migrated decision and its catalog membership', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const hub = yield* create(demo, { projectId, tags: ['spec'], title: 'the hub' });
        const shipped = yield* declarationOf(demo, 'spec');
        if (shipped === undefined) return yield* Effect.die('the fixture installs no spec');
        yield* retire(demo);
        const decision = yield* declarationOf(demo, 'decision');
        if (decision === undefined || decision.uuid === null) return yield* Effect.die('the retirement left no decision');
        const duplicateUuid = mintBlockId();
        const { db } = graph.graphStore;
        const duplicate = yield* db
          .insert(block)
          .values({
            uuid: duplicateUuid,
            projectId,
            parentId: decision.parentId,
            ord: 1,
            tags: ['tag'],
            fields: shipped.fields,
            title: '#spec',
            body: shipped.body,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          })
          .returning()
          .get();
        if (duplicate === undefined) return yield* Effect.die('the duplicate was not written');
        yield* db.insert(blockTag).values({ blockId: duplicate.id, tag: 'tag' });
        const listing = (yield* rows(demo)).find((row) => row.tags.includes('catalog') && row.fields.id === 'code-project');
        if (listing === undefined) return yield* Effect.die('the fixture installs no code-project catalog');
        const members = (listing.fields.tags as string[]).filter((name) => name !== blockName(decision.uuid));
        yield* db
          .update(block)
          .set({ fields: { ...listing.fields, tags: [...members, blockName(duplicateUuid)] } })
          .where(eq(block.id, listing.id));
        yield* graph.tags.forget(projectId);
        yield* decisionBecomesSpec(yield* graph.projects.byId(projectId));
        yield* graph.tags.forget(projectId);
        const declared = (yield* rows(demo)).filter(
          (row) => row.deletedAt === null && row.tags.includes('tag') && (row.fields.id === 'spec' || row.fields.id === 'decision'),
        );
        expect(declared.map((row) => row.uuid)).toEqual([decision.uuid]);
        expect((yield* graph.blocks.rawBlockById(duplicate.id)).deletedAt).toBeInstanceOf(Date);
        expect((yield* graph.blocks.rawBlockById(listing.id)).fields.tags).toEqual([...members, blockName(decision.uuid)]);
        expect((yield* graph.blocks.blockById(hub)).tags).toEqual(['spec']);
        expect((yield* demo.table()).unreadable).toEqual([]);
      }),
    ),
  );

  it.effect('claims and their proposals retire, surviving children rise, and declarations lose the claim role', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const home = yield* create(demo, { projectId, tags: ['idea'], title: 'home' });
        const { db } = graph.graphStore;
        const insert = Effect.fnUntraced(function* (values: { parentId: number; tags: string[]; fields: Raw; title: string }) {
          const row = yield* db
            .insert(block)
            .values({ uuid: mintBlockId(), projectId, ord: 1, body: '', createdAt: new Date(0), updatedAt: new Date(0), ...values })
            .returning()
            .get();
          if (row === undefined) return yield* Effect.die('a row was not written');
          return row.id;
        });
        const root = yield* graph.blocks.rootBlockOf(projectId);
        const declaration = yield* insert({
          parentId: root.id,
          tags: ['tag'],
          fields: { id: 'claim', roles: { claim: true } },
          title: '#claim',
        });
        const claim = yield* insert({ parentId: home, tags: ['claim'], fields: {}, title: 'a claim' });
        const proposal = yield* insert({ parentId: claim, tags: ['proposal'], fields: {}, title: 'amend the claim' });
        const kept = yield* insert({ parentId: claim, tags: ['idea'], fields: {}, title: 'an idea under the claim' });
        const idea = yield* declarationOf(demo, 'idea');
        if (idea === undefined) return yield* Effect.die('the fixture installs no idea');
        yield* db
          .update(block)
          .set({ fields: { ...idea.fields, roles: { ...(idea.fields.roles as Raw), claim: true } } })
          .where(eq(block.id, idea.id));
        yield* claimsLeave(yield* graph.projects.byId(projectId));
        yield* graph.tags.forget(projectId);
        for (const id of [declaration, claim, proposal]) expect((yield* graph.blocks.rawBlockById(id)).deletedAt).toBeInstanceOf(Date);
        const survivor = yield* graph.blocks.rawBlockById(kept);
        expect([survivor.parentId, survivor.deletedAt]).toEqual([home, null]);
        expect(((yield* graph.blocks.rawBlockById(idea.id)).fields.roles as Raw).claim).toBeUndefined();
        expect((yield* demo.table()).unreadable).toEqual([]);
      }),
    ),
  );

  it.effect('discovery leaves declarations while nodes retain their provenance and repeated migration preserves rows', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const declaration = yield* graph.blocks.create({
          projectId,
          tags: ['tag'],
          title: '#finding',
          fields: { id: 'finding', edges: ['relates', 'discovered-from', { kind: 'discovered-from', to: ['task'] }] },
        });
        const origin = yield* create(demo, { projectId, tags: ['task'], title: 'origin' });
        const found = yield* create(demo, {
          projectId,
          tags: ['finding'],
          title: 'found',
          edges: [{ kind: 'discovered-from', to: origin }],
        });
        const project = yield* graph.projects.byId(projectId);
        yield* provenanceLeaves(project);
        const once = yield* rows(demo);
        yield* provenanceLeaves(project);
        expect(yield* rows(demo)).toEqual(once);
        yield* graph.tags.forget(projectId);
        expect((yield* graph.blocks.rawBlockById(declaration.id)).fields.edges).toEqual(['relates']);
        expect((yield* graph.reading.show(found, 0)).edgesOut.map((edge) => [edge.kind, edge.toId])).toEqual([['discovered-from', origin]]);
        expect((yield* demo.table()).unreadable).toEqual([]);
      }),
    ),
  );

  it.effect('stored amendment creation relations migrate in a custom field and can be accepted after the idempotent step', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        yield* graph.blocks.create({
          projectId,
          tags: ['tag'],
          title: '#finding',
          fields: {
            id: 'finding',
            fields: {
              phase: { type: 'enum', values: ['draft', 'applied', 'rejected', 'upheld'] },
              changes: { type: 'schema', name: 'amendmentOps' },
              enabled: 'boolean',
              source: { type: 'schema', name: 'researchSource' },
            },
            roles: {
              status: { field: 'phase', initial: 'draft' },
              amendment: { field: 'changes', run: 'applied', declined: 'rejected', answered: 'upheld' },
            },
            gates: ['applied', 'rejected', 'upheld'].map((to) => ({ gate: 'transition', field: 'phase', from: 'draft', to })),
          },
        });
        const target = yield* create(demo, { projectId, tags: ['spec'], title: 'target' });
        const name = yield* demo.nameOf(target);
        const core = { op: 'create', $id: 'builder', tags: ['task'], title: 'migrated work', parentId: name, body: 'before' };
        const edit = { op: 'edit', id: '$builder', old: 'before', new: 'after' };
        const source = { name: 'System', ref: 'record' };
        const proposal = yield* graph.blocks.create({
          projectId,
          tags: ['finding'],
          title: 'stored finding',
          amendsId: target,
          fields: { enabled: true, source, changes: [{ ...core, edges: [{ kind: 'implements', to: name }] }, edit] },
        });
        yield* graph.graphStore.db
          .update(block)
          .set({ fields: { ...proposal.fields, changes: [{ ...core, implementsId: name, discoveredFromId: name }, edit] } })
          .where(eq(block.id, proposal.id));
        const project = yield* graph.projects.byId(projectId);
        yield* creationEdges(project);
        const once = yield* rows(demo);
        yield* creationEdges(project);
        expect(yield* rows(demo)).toEqual(once);
        expect((yield* graph.blocks.rawBlockById(proposal.id)).fields).toEqual({
          ...proposal.fields,
          changes: [
            {
              ...core,
              edges: [
                { kind: 'implements', to: name },
                { kind: 'discovered-from', to: name },
              ],
            },
            edit,
          ],
        });
        yield* graph.review.accept({ id: proposal.id });
        const child = (yield* graph.blocks.childrenOf(target)).find((row) => row.title === core.title);
        if (child === undefined) return yield* Effect.die('the migrated create did not land');
        expect(child.body).toBe(edit.new);
        expect(
          (yield* graph.reading.show(child.id, 0)).edgesOut
            .filter((edge) => edge.toId === target)
            .map((edge) => edge.kind)
            .sort(),
        ).toEqual(['discovered-from', 'implements']);
      }),
    ),
  );

  it.effect('checkout measurements leave enforcement while current law decodes and repeating the step preserves rows', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const law: LawEnforcement = {
          strictness: 'gate',
          on: [{ op: 'submit_work', phase: 'before' }],
          inspection: 'size',
          debt: [{ fingerprint: 'F4 core/a.ts', owner: 'aaaaaaaa', value: 700 }],
          escaped: [],
        };
        const { inspection: _inspection, ...held } = law;
        const size = {
          builtin: 'size',
          params: {
            base: 'src',
            files: { extensions: ['.ts'], exclude: [] },
            thresholds: [{ glob: '**', metric: 'non-import', lines: 650 }],
          },
        };
        const rule = yield* graph.blocks.create({ projectId, tags: ['rule'], title: 'files stay small' });
        yield* graph.graphStore.db
          .update(block)
          .set({
            fields: {
              ...rule.fields,
              enforcement: {
                ...held,
                checks: [size],
                baseline: { commit: 'a'.repeat(40) },
                measured: { ms: 10, at: '2026-09-29T00:00:00.000Z' },
              },
            },
          })
          .where(eq(block.id, rule.id));
        const project = yield* graph.projects.byId(projectId);
        yield* measurementsLeave(project);
        const once = yield* rows(demo);
        yield* measurementsLeave(project);
        expect(yield* rows(demo)).toEqual(once);
        yield* ruleInspections(project);
        const stored = (yield* graph.blocks.rawBlockById(rule.id)).fields.enforcement;
        expect(yield* Schema.decodeUnknownEffect(lawEnforcementSchema)(stored, closedParsing)).toEqual(law);
      }),
    ),
  );
});
