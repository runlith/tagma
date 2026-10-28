import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import type { LawEnforcement } from '../../../../graph/contract/wire/enforcement.js';
import { block } from '../../../../graph/store/tables.js';
import { TRIGGERS } from '../../../../graph/testing/triggers.js';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';

const declare = (projectId: number, id: string, fields: Record<string, unknown>) =>
  Effect.flatMap(Blocks, ({ create, rootBlockOf }) =>
    Effect.flatMap(rootBlockOf(projectId), (root) =>
      create({ projectId, parentId: root.id, tags: ['tag'], title: `#${id}`, body: `A #${id}.`, fields: { id, ...fields } }),
    ),
  );

const severity = (values: readonly [string, ...string[]]) => ({
  fields: { severity: { type: 'enum' as const, values } },
  gates: [{ gate: 'required', field: 'severity' }],
});

const document: LawEnforcement = {
  strictness: 'gate',
  on: TRIGGERS.landing,
  inspection: 'reexports',
  debt: [],
  escaped: [],
};

layer(demoGraphLayer(), { excludeTestServices: true })('vocabulary closure', (it) => {
  it.effect('trashing and restoring a base removes and restores inherited law and fields without changing its carrier', () =>
    withDemo(({ graph, projectId, root, table }) =>
      Effect.gen(function* () {
        const required = severity(['low', 'high']);
        const norm = yield* declare(projectId, 'norm', {
          ...required,
          fields: { ...required.fields, enabled: 'boolean', enforcement: { type: 'schema', name: 'lawEnforcement' } },
          roles: { law: 'enabled', enforcement: 'enforcement' },
        });
        yield* declare(projectId, 'standard', { extends: 'norm', fields: { component: 'string' } });
        const carrier = yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['standard'],
          title: 'Import only downward',
          fields: { severity: 'high', component: 'ui' },
        });
        yield* graph.graphStore.db
          .update(block)
          .set({ fields: { ...carrier.fields, enforcement: document } })
          .where(eq(block.id, carrier.id));
        const before = yield* graph.blocks.blockById(carrier.id);
        const projected = (yield* table()).lawProjection(before);
        expect(projected?.enforcement?.field).toBe('enforcement');
        yield* graph.trash.delete({ id: norm.id });
        expect((yield* table()).tagById('standard')).toBeNull();
        yield* graph.trash.restore({ id: norm.id });
        expect((yield* table()).tagById('standard')?.fields.severity).toEqual(required.fields.severity);
        expect((yield* table()).lawProjection(before)).toEqual(projected);
        expect(yield* graph.blocks.blockById(carrier.id)).toEqual(before);
      }),
    ),
  );

  it.effect('repairing an unreadable base validates transitive carriers and rolls back a repair they refuse', () =>
    withDemo(({ graph, projectId, root, refusal, table, nameOf }) =>
      Effect.gen(function* () {
        const base = yield* declare(projectId, 'finding', severity(['low', 'high']));
        yield* declare(projectId, 'triage', {
          fields: { severity: 'string', release: 'string' },
          gates: [{ gate: 'required', field: 'release' }],
        });
        yield* declare(projectId, 'audit', { fields: { severity: 'string' } });
        const middle = yield* declare(projectId, 'defect', { extends: 'finding' });
        yield* declare(projectId, 'regression', { extends: 'defect' });
        const relapse = yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['regression'],
          title: 'came back',
          fields: { severity: 'low' },
        });
        yield* graph.trash.delete({ id: base.id });
        expect((yield* table()).tagById('regression')).toBeNull();
        const before = yield* graph.blocks.blockById(middle.id);
        const refused = yield* refusal(graph.blocks.update({ id: middle.id, fields: { extends: 'triage' } }));
        expect(refused.code).toBe('carriers-invalid');
        expect(refused.reason).toContain(yield* nameOf(relapse.id));
        expect(yield* graph.blocks.blockById(middle.id)).toEqual(before);
        expect((yield* table()).tagById('regression')).toBeNull();
        yield* graph.blocks.update({ id: middle.id, fields: { extends: 'audit' } });
        expect((yield* table()).tagById('regression')?.extends).toBe('defect');
      }),
    ),
  );
});
