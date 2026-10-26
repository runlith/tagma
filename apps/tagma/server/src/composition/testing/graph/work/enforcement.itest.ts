import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { type LawEnforcement, type Strictness } from '../../../../graph/contract/wire/enforcement.js';
import { TRIGGERS } from '../../../../graph/testing/triggers.js';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';

const enforcementDocument = (strictness: Strictness): LawEnforcement => ({
  strictness,
  on: TRIGGERS.landing,
  inspection: 'reexports',
  debt: [],
  escaped: [],
});

const enforcedRule = Effect.fnUntraced(function* (projectId: number, strictness: Strictness, parentId?: number) {
  const blocks = yield* Blocks;
  const rule = yield* blocks.create({ projectId, tags: ['rule'], title: 'Enforced', parentId });
  return yield* blocks.setEnforcement({
    id: rule.id,
    anchors: [],
    stood: undefined,
    document: enforcementDocument(strictness),
    journal: {},
  });
});

layer(demoGraphLayer(), { excludeTestServices: true })('enforcement ownership', (it) => {
  it.effect('a document is written through its owner and refused at ordinary birth or update without changing the rule', () =>
    withDemo(({ graph, projectId, refusal }) =>
      Effect.gen(function* () {
        const document = enforcementDocument('gate');
        expect(
          (yield* refusal(graph.blocks.create({ projectId, tags: ['rule'], title: 'Forged', fields: { enforcement: document } }))).code,
        ).toBe('operation-only');
        const rule = yield* enforcedRule(projectId, 'note');
        const before = yield* graph.blocks.blockById(rule.id);
        expect(before.fields.enforcement).toEqual(enforcementDocument('note'));
        expect((yield* refusal(graph.blocks.update({ id: rule.id, fields: { enforcement: document } }))).code).toBe('operation-only');
        expect(yield* graph.blocks.blockById(rule.id)).toEqual(before);
      }),
    ),
  );

  it.effect('an enforcement role requires a law role and a document field, and a valid binding is published', () =>
    withDemo(({ graph, projectId, refusal, table }) =>
      Effect.gen(function* () {
        const declare = (fields: object, roles: object) =>
          graph.blocks.create({ projectId, tags: ['tag'], title: '#norm', fields: { id: 'norm', fields, roles } });
        const document = { type: 'schema', name: 'lawEnforcement' };
        expect((yield* refusal(declare({ document }, { enforcement: 'document' }))).code).toBe('tag-incoherent');
        expect((yield* refusal(declare({ on: 'boolean', document: 'string' }, { law: 'on', enforcement: 'document' }))).code).toBe(
          'tag-incoherent',
        );
        yield* declare({ on: 'boolean', document }, { law: 'on', enforcement: 'document' });
        expect((yield* table()).lawProjectionOf('norm')?.enforcement).toEqual({ field: 'document', schema: 'lawEnforcement' });
      }),
    ),
  );

  it.effect('gate enforcement preserves the ordinary switch, replacement and subtree-trash transitions', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const off = yield* enforcedRule(projectId, 'gate');
        yield* graph.blocks.setEnabled({ id: off.id, enabled: false });
        expect((yield* graph.blocks.blockById(off.id)).fields.enabled).toBe(false);
        const replaced = yield* enforcedRule(projectId, 'gate');
        const successor = yield* graph.blocks.create({ projectId, tags: ['rule'], title: 'Successor' });
        expect((yield* graph.standing.supersede({ oldId: replaced.id, withId: successor.id })).superseded).toBe(true);
        const area = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Product' });
        const trashed = yield* enforcedRule(projectId, 'gate', area.id);
        yield* graph.trash.delete({ id: area.id });
        expect((yield* graph.blocks.rawBlockById(trashed.id)).deletedAt).toBeInstanceOf(Date);
      }),
    ),
  );
});
