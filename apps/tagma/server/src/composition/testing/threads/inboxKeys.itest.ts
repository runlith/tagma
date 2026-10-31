import { fixtureMigrations } from '../migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { ENTRY_KINDS } from '../composed.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Clock, Effect, Layer } from 'effect';
import { callKey, type Keyed } from '@runlith/agent/thread/keyed';
import type { InboxPlan } from '@runlith/agent/thread/storage/inbox';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { threadInboxStore } from '../../../threads/testing/doubles.js';
import { bornThread } from '../../../native-harness/testing/born.js';

const setup = Effect.fnUntraced(function* () {
  let runtime: Context.Context<MachineUnits | MachineStore>;
  const control = <A>(plan: InboxPlan<A>, key: Keyed) =>
    Effect.provide(
      Effect.gen(function* () {
        const inbox = yield* threadInboxStore(ENTRY_KINDS);
        return yield* Effect.result(inbox.control('holder', plan, { key, deadline: new Date((yield* Clock.currentTimeMillis) + 60_000) }));
      }),
      runtime,
    );
  runtime = yield* Layer.build(
    unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(
        Layer.orDie(Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, {}, pool)))),
      ),
    ),
  );
  yield* Effect.provide(
    Effect.gen(function* () {
      const store = yield* MachineStore;
      yield* bornThread(store.db, {
        id: 'holder',
        ownerId: 'operator',
        agentId: 'harness',
        authority: { mode: 'trust', bypassFrom: null },
        status: 'running',
        createdAt: new Date(0),
        updatedAt: new Date(0),
        spawnRootId: 'holder',
        cacheGroup: 'holder',
        name: 'holder',
      });
    }),
    runtime,
  );
  return { control, inbox: yield* Effect.provide(threadInboxStore(ENTRY_KINDS), runtime) };
});

it.live('a stored signal awaiting delivery reads through its owner form without changing its accepted identity', () =>
  Effect.gen(function* () {
    const { inbox } = yield* setup();
    const id = 'law-escaped:5:rule:commit';
    yield* inbox.put({
      id,
      threadId: 'holder',
      sender: { kind: 'host' },
      kind: 'signal',
      body: { type: 'law-escaped', addressee: 'transport', text: 'raises law-escaped' },
      occurredAt: '2026-10-22T00:00:00.000Z',
    });
    const receipt = yield* inbox.receipt(id);
    expect(receipt).toMatchObject({ id, state: 'queued', body: { type: 'rule-escaped', text: 'raises rule-escaped' } });
    expect((yield* inbox.launchItems('holder')).readable.map((item) => item.id)).toEqual([id]);
  }),
);

const answering = (answer: string, ran: string[]): InboxPlan<string> => ({
  decide: () => Effect.succeed({ apply: () => Effect.sync(() => void ran.push(answer)), result: answer }),
});

it.live(
  'a keyed inbox act repeated answers what it recorded, and the same key over other content conflicts',
  Effect.fnUntraced(function* () {
    const { control } = yield* setup();
    const evidence = { call: callKey({ operation: 'send', actor: 'holder', key: 'one-call' }) };
    const ran: string[] = [];
    expect(yield* control(answering('first', ran), { evidence, digest: 'words' })).toMatchObject({ success: { committed: 'first' } });
    expect(yield* control(answering('second', ran), { evidence, digest: 'words' })).toMatchObject({ success: { replayed: 'first' } });
    expect(yield* control(answering('third', ran), { evidence, digest: 'other words' })).toMatchObject({
      failure: { _tag: 'InboxConflict', reason: 'act-id-reused' },
    });
    expect(ran).toEqual(['first']);
  }),
);
