import { expect } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { ToolAnswer, toolExecute, toolPrepare } from '@runlith/agent/tool';
import { unthreadedCaller } from '../callers.js';
import { fixtureNativeCatalog } from '../nativeCatalog.js';
import { type EffectDemo, demoGraphLayer, withDemo } from '../graphFixture.js';
import { sessionIdentity } from '../../../external-harnesses/sessionPrefix.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { WRITE_OPERATIONS } from '../../../graph/contract/wire/operations/writes.js';
import { WORK_OPERATIONS } from '../../../graph/contract/wire/operations/work.js';
import { refusalSchema } from '../../../platform/contract/wire/refusal.js';

const born = Schema.decodeUnknownEffect(knownAnswer(WRITE_OPERATIONS.create_block.answer));
const batched = Schema.decodeUnknownEffect(knownAnswer(WORK_OPERATIONS.apply_batch.answer));
const refused = Schema.decodeUnknownEffect(refusalSchema);

const callsFor = Effect.fnUntraced(function* (demo: EffectDemo) {
  const { graph, projectId } = demo;
  const tools = yield* fixtureNativeCatalog(
    {
      caller: {
        actor: {
          kind: 'thread',
          threadId: 'create-claim',
          projectId,
          principalId: 'owner',
          session: { harness: 'tagma', key: 'create-claim' },
        },
        files: null,
      },
      place: { root: demo.demoRoot, origin: null },
      project: { id: projectId, name: 'demo' },
      vocabulary: yield* graph.tags.reader(projectId),
      identity: sessionIdentity,
      world: 'checkout',
      graphRoot: demo.demoRoot,
      owners: demo.context,
    },
    ['create_block', 'update_block', 'apply_batch', 'claim_block', 'read_tags'],
  );
  let calls = 0;
  const call = Effect.fnUntraced(function* (id: string, input: Record<string, unknown>) {
    const tool = tools[id]!;
    const toolCallId = `create-claim-${++calls}`;
    const prepared = yield* toolPrepare(tool)!(input, { toolCallId, caller: unthreadedCaller });
    const answered = yield* toolExecute(tool)!(input, { toolCallId, caller: unthreadedCaller, messages: [], prepared: prepared.prepared });
    return answered instanceof ToolAnswer ? answered.value : answered;
  });
  const rootName = yield* demo.nameOf(demo.root);
  const create = (input: Record<string, unknown>) => Effect.flatMap(call('create_block', { parentId: rootName, ...input }), born);
  const held = Effect.fnUntraced(function* (name: string, status: string) {
    const row = yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(name));
    const table = yield* demo.table();
    expect(table.statusOf(row)).toBe(status);
    const holder = table.holderOf(row);
    expect(holder).not.toBeNull();
    expect(yield* graph.sessions.byId(holder!)).toMatchObject({ harness: 'tagma', key: 'create-claim' });
  });
  const children = Effect.fnUntraced(function* () {
    const root = yield* graph.blocks.rootBlockOf(projectId);
    return (yield* graph.blocks.childrenOf(root.id)).map((row) => row.uuid);
  });
  const declare = (id: string, transitions: readonly [string, string][]) =>
    create({
      tags: ['tag'],
      title: id,
      fields: {
        id,
        fields: { phase: { type: 'enum', values: ['waiting', 'busy', 'ended'] }, owner: 'session' },
        roles: { status: { field: 'phase', initial: 'waiting', claimed: 'busy' }, holder: 'owner' },
        gates: transitions.map(([from, to]) => ({ gate: 'transition', field: 'phase', from, to })),
      },
    });
  return { call, create, held, children, declare, rootName };
});

layer(demoGraphLayer())('a birth names its parent', (it) => {
  it.effect(
    'a create naming no parent refuses, naming the root among its ways out and writing nothing; a page past a screen of one role is named',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { graph, projectId } = demo;
          const { call, create, children, rootName } = yield* callsFor(demo);
          yield* Effect.sync(() => {
            mkdirSync(join(demo.demoRoot, 'engine'), { recursive: true });
            writeFileSync(join(demo.demoRoot, 'engine', 'core.ts'), 'export const core = 1;\n');
          });
          const [engineId] = yield* graph.blocks.writeModules(
            projectId,
            [{ id: 'engine', title: 'Engine', parent: demo.root, root: 'engine' }],
            [],
          );
          const engine = { id: engineId! };
          const engineName = yield* demo.nameOf(engine.id);
          const before = yield* children();
          const stray = yield* Effect.flatMap(
            call('create_block', { tags: ['idea'], title: 'Stray', sources: [{ kind: 'file', ref: 'engine/core.ts' }] }),
            refused,
          );
          expect(stray.code).toBe('parent-required');
          expect(stray.unblock.some((way) => way.includes(rootName))).toBe(true);
          expect(yield* children()).toEqual(before);
          for (let at = 0; at < 20; at += 1)
            yield* graph.blocks.create({ projectId, parentId: engine.id, tags: ['idea'], title: `idea ${at}` });
          const past = yield* create({ parentId: engineName, tags: ['idea'], title: 'one more idea' });
          expect(past.crowded).toEqual({ parent: engineName, title: 'Engine', role: 'knowledge', children: 21 });
          const part = yield* create({ parentId: engineName, tags: ['zone'], title: 'a part' });
          expect(part.crowded).toBeUndefined();
          const retagged = yield* Effect.flatMap(call('update_block', { blockId: part.block.name, tags: ['idea'] }), born);
          expect(retagged.crowded).toEqual({ parent: engineName, title: 'Engine', role: 'knowledge', children: 22 });
        }),
      ),
  );
});

layer(demoGraphLayer())('atomic native create claims', (it) => {
  it.effect('direct, batch and later claims bind custom fields to the caller and return their committed state', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { call, create, held, declare, rootName } = yield* callsFor(demo);
        const created = yield* create({ tags: ['task'], title: 'Taken at birth', claim: true });
        expect(created.block.fields).toMatchObject({ status: 'in_work' });
        yield* held(created.block.name, 'in_work');
        const open = yield* create({ tags: ['task'], title: 'Waiting at birth', claim: false });
        const table = yield* demo.table();
        expect(table.statusOf(open.block)).toBe('open');
        expect(table.holderOf(open.block)).toBeNull();
        yield* declare('assignment', [
          ['waiting', 'busy'],
          ['busy', 'waiting'],
        ]);
        yield* held((yield* create({ tags: ['assignment'], title: 'Custom hold', claim: true })).block.name, 'busy');
        const batch = yield* Effect.flatMap(
          call('apply_batch', {
            ops: [{ op: 'create', $id: 'taken', parentId: rootName, tags: ['assignment'], title: 'Batch hold', claim: true }],
          }),
          batched,
        );
        yield* held(batch.ids.taken!, 'busy');
        const waiting = yield* create({ tags: ['assignment'], title: 'Claim separately' });
        yield* call('claim_block', { blockId: waiting.block.name });
        yield* held(waiting.block.name, 'busy');
      }),
    ),
  );

  it.effect('refused claims roll back direct and batch births, and incomplete lifecycles offer executable recovery', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { call, create, children, declare, rootName } = yield* callsFor(demo);
        yield* declare('gated-assignment', [
          ['waiting', 'ended'],
          ['busy', 'waiting'],
        ]);
        const target = (yield* create({ tags: ['idea'], title: 'Amendment target' })).block.name;
        const attempts = [
          [call('create_block', { parentId: rootName, tags: ['idea'], title: 'Cannot hold', claim: true }), 'no-holder'],
          [
            call('create_block', { parentId: rootName, tags: ['gated-assignment'], title: 'Blocked claim', claim: true }),
            'illegal-transition',
          ],
          [
            call('create_block', {
              tags: ['proposal'],
              title: 'Deferred hold',
              amendsId: target,
              fields: { ops: [{ op: 'create', parentId: target, tags: ['task'], title: 'Deferred task', claim: true }] },
            }),
            'field-invalid',
          ],
          [
            call('apply_batch', {
              ops: [
                { op: 'create', $id: 'taken', parentId: rootName, tags: ['task'], title: 'Rolled back hold', claim: true },
                { op: 'create', parentId: rootName, tags: ['idea'], title: 'Refused hold', claim: true },
              ],
            }),
            'no-holder',
          ],
        ] as const;
        for (const [attempt, code] of attempts) {
          const before = yield* children();
          expect((yield* Effect.flatMap(attempt, refused)).code).toBe(code);
          expect(yield* children()).toEqual(before);
        }

        for (const lifecycle of [false, true]) {
          const id = lifecycle ? 'unclaimed-lifecycle' : 'holder-only';
          const fields: Record<string, unknown> = { owner: 'session' };
          const roles: Record<string, unknown> = { holder: 'owner' };
          if (lifecycle) {
            fields.phase = { type: 'enum', values: ['waiting', 'ended'] };
            roles.status = { field: 'phase', initial: 'waiting' };
          }
          yield* create({
            tags: ['tag'],
            title: id,
            fields: { id, fields, roles, gates: lifecycle ? [{ gate: 'transition', field: 'phase', from: 'waiting', to: 'ended' }] : [] },
          });
          const before = yield* children();
          const refusal = yield* Effect.flatMap(
            call('create_block', { parentId: rootName, tags: [id], title: 'Cannot claim yet', claim: true }),
            refused,
          );
          expect(refusal.code).toBe('illegal-status');
          expect(yield* call(refusal.unblock[0]!.split(' ')[0]!, {})).toMatchObject({ status: 'ok' });
          expect(yield* children()).toEqual(before);
        }
      }),
    ),
  );
});
