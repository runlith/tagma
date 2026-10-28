import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { ToolAnswer } from '@runlith/agent/tool';
import { Effect } from 'effect';
import { GraphTools, graphToolsFixture } from './graphTools.fixture.js';

layer(graphToolsFixture, { excludeTestServices: true })('native rule operations', (it) => {
  it.effect('code delivery without sources warns its caller while keeping the whole-project gate', () =>
    Effect.gen(function* () {
      const { graph, call, answer, rootName } = yield* GraphTools;
      const created = (yield* call('create_block', { parentId: yield* rootName(), tags: ['rule'], title: 'Preserve project data' })) as {
        block: { name: string };
      };
      const name = created.block.name;
      const id = yield* graph.blockNames.idOfName(name);
      const document = {
        inspection: 'data',
        strictness: 'gate' as const,
        on: [{ op: 'submit_work', phase: 'before' as const }],
        debt: [],
        escaped: [],
      };
      yield* graph.blocks.setEnforcement({ id, anchors: [], stood: undefined, document, journal: {} });
      const switched = yield* answer('set_rule_delivery', { blockId: name, delivery: 'code' });
      expect(switched).toBeInstanceOf(ToolAnswer);
      if (!(switched instanceof ToolAnswer)) return yield* Effect.die('The native rule operation returned no tool answer.');
      const value = switched.value as { status: string; warning?: string; block: { fields: Record<string, unknown> } };
      expect(value.status).toBe('ok');
      expect(value.warning).toEqual(expect.any(String));
      expect(switched.text).toContain(value.warning!);
      expect(value.block.fields.enforcement).toEqual(document);
      const read = (yield* call('read_block', { blockIds: [name], depth: 0 })) as { reads: { sources: unknown[]; reach: unknown }[] };
      expect(read.reads[0]!.sources).toEqual([]);
      expect((yield* graph.blocks.blockById(id)).fields.delivery).toBe('code');
      const restored = yield* call('set_rule_delivery', { blockId: name, delivery: 'prompt' });
      expect(restored.warning).toBeUndefined();
      yield* call('anchor_block', { blockId: name, kind: 'dir', ref: '.' });
      expect((yield* call('set_rule_delivery', { blockId: name, delivery: 'code' })).warning).toBeUndefined();
    }),
  );

  it.effect('law fields follow their declared operations, including fields with project-defined names', () =>
    Effect.gen(function* () {
      const { call, nativeCall, rootName } = yield* GraphTools;
      const parentId = yield* rootName();
      yield* call('create_block', {
        parentId,
        tags: ['tag'],
        title: 'Project norm',
        fields: {
          id: 'norm',
          fields: { live: 'boolean', route: { type: 'enum', values: ['prompt', 'code'] } },
          contracts: { 'core/law': { slots: { enabled: 'live', delivery: 'route' }, words: {} } },
        },
      });
      const created = (yield* call('create_block', { parentId, tags: ['norm'], title: 'Keep records' })) as { block: { name: string } };
      const blockId = created.block.name;
      expect(yield* call('set_rule_enabled', { blockId, enabled: false })).toMatchObject({
        status: 'ok',
        block: { fields: { live: false } },
      });
      expect(yield* nativeCall('update_block', { blockId, fields: { live: true } })).toMatchObject({
        status: 'refused',
        code: 'operation-only',
      });
      expect(yield* call('read_block', { blockIds: [blockId], depth: 0 })).toMatchObject({ reads: [{ fields: { live: false } }] });
      expect(yield* nativeCall('update_block', { blockId, fields: { route: 'code' } })).toMatchObject({
        status: 'refused',
        code: 'operation-only',
      });
      expect(yield* call('set_rule_enabled', { blockId, enabled: true })).toMatchObject({ status: 'ok', block: { fields: {} } });
      expect(yield* call('set_rule_delivery', { blockId, delivery: 'prompt' })).toMatchObject({
        status: 'ok',
        block: { fields: { route: 'prompt' } },
      });
    }),
  );
});
