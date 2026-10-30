import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { eq } from 'drizzle-orm';
import { Message } from '@runlith/llm/schema/messages';
import { THREAD_AUTHORITY_DEFAULT } from '@runlith/agent/thread/rows';
import { ThreadRequestMeter } from '@runlith/agent/thread/compaction/ThreadRequestMeter';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { unitsLayer } from '../../platform/store/units.js';
import { threadEvent } from '../../threads/store/journal.js';
import { bornThread } from '../testing/born.js';
import { threadHistoryItem, threadLog } from '../store/thread.js';
import { makeHistoryStore } from './history.js';
import { ThreadEntryKinds, makeThreadEntryReader, type ThreadEntryReader, type ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { instructionSnapshot, instructionsTold } from '../turns/instructions.js';
import { instructionForm } from '../steps/projectInstructions.js';
import { journalSteps } from '../../threads/journal/formSteps.js';

const layer = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, { readers: 0 }, sharedPool))),
);
const changed = writes('history.test', [threadEvent, threadLog, threadHistoryItem]);
const historyOf = (kinds: ThreadEntryReader) => makeHistoryStore({ reads: undefined }).pipe(Effect.provideService(ThreadEntryKinds, kinds));

const exercise = Effect.fnUntraced(function* (rollback: boolean) {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const history = yield* historyOf(makeThreadEntryReader({ products: [] }));
  const id = 'history-projection';
  yield* bornThread(store.db, {
    id,
    ownerId: 'owner',
    agentId: 'agent',
    spawnRootId: id,
    authority: THREAD_AUTHORITY_DEFAULT,
  });
  yield* store.db.insert(threadLog).values({ threadId: id });
  yield* units.write(changed, (unit) => history.write(unit, id, [Message.make({ role: 'user', content: 'retained' })], 0));
  const before = yield* units.read((unit) => history.read(unit, id));
  if (before === null) return yield* Effect.die(new Error('history was not born'));

  const projected = yield* units
    .write(changed, (unit) =>
      Effect.gen(function* () {
        yield* unit.run(store.db.insert(threadEvent).values({ threadId: id, id: 'silent', position: 1, kind: 'step', payload: {} }));
        yield* history.project(unit, id);
        if (rollback) return yield* Effect.fail('rollback');
      }),
    )
    .pipe(Effect.result);
  expect(projected._tag).toBe(rollback ? 'Failure' : 'Success');
  const after = yield* units.read((unit) => history.read(unit, id));
  expect(after).toEqual(before);
  expect(after?.[0]).toBe(before[0]);
  const log = yield* store.db.select().from(threadLog).where(eq(threadLog.threadId, id)).get();
  expect(log?.historyThrough).toBe(rollback ? 0 : 1);

  yield* units.write(changed, (unit) =>
    Effect.gen(function* () {
      yield* unit.run(
        store.db.insert(threadEvent).values({
          threadId: id,
          id: 'spoken',
          position: rollback ? 1 : 2,
          kind: 'message',
          payload: { messages: [Message.make({ role: 'assistant', content: 'new' })] },
        }),
      );
    }),
  );
  const replayed = yield* units.read((unit) => history.read(unit, id));
  expect(replayed).toEqual([...before, Message.make({ role: 'assistant', content: 'new' })]);
  expect(replayed?.[0]).toBe(before[0]);
  yield* units.write(changed, (unit) =>
    unit.run(
      store.db.insert(threadEvent).values({
        threadId: id,
        id: 'silent-tail',
        position: rollback ? 2 : 3,
        kind: 'step',
        payload: {},
      }),
    ),
  );
  const silent = yield* units.read((unit) => history.read(unit, id));
  expect(silent).toBe(replayed);
});

const texted = (content: string) => [{ type: 'text' as const, text: content }];

const plainContent: ThreadFormStep = {
  name: '20261010170000_plain_content',
  samples: { message: { role: 'user', content: 'before' } },
  message: (message) => (typeof message.content === 'string' ? { ...message, content: texted(message.content) } : null),
};

it.live('the history a continuing run reads comes in the current form from items and events stored in an old one', () => {
  const read = Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    const history = yield* historyOf(makeThreadEntryReader({ products: [], steps: [plainContent] }));
    const id = 'history-old-forms';
    yield* bornThread(store.db, { id, ownerId: 'owner', agentId: 'agent', spawnRootId: id, authority: THREAD_AUTHORITY_DEFAULT });
    yield* store.db.insert(threadLog).values({ threadId: id });
    yield* store.db.insert(threadHistoryItem).values({ threadId: id, ord: 0, message: { role: 'user', content: 'asked' } as never });
    yield* store.db.insert(threadEvent).values({
      threadId: id,
      id: 'old-spoken',
      position: 1,
      kind: 'message',
      payload: { messages: [{ role: 'assistant', content: 'told' }] } as never,
    });
    return yield* units.read((unit) => history.read(unit, id));
  });

  return Effect.map(read.pipe(Effect.provide(layer)), (answered) =>
    expect(answered).toEqual([
      { role: 'user', content: texted('asked') },
      { role: 'assistant', content: texted('told') },
    ]),
  );
});

it.live('instruction lookup forms a stored snapshot before selecting its project key', () => {
  const snapshot = { projectId: 1, root: '/project', complete: true, audience: 'graph', entries: [] } as const;
  const read = Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    const history = yield* historyOf(makeThreadEntryReader({ products: [], steps: journalSteps([[instructionForm]]) }));
    const id = 'instruction-form';
    yield* bornThread(store.db, { id, ownerId: 'owner', agentId: 'agent', spawnRootId: id, authority: THREAD_AUTHORITY_DEFAULT });
    yield* store.db.insert(threadLog).values({ threadId: id });
    yield* store.db.insert(threadHistoryItem).values({
      threadId: id,
      ord: 0,
      message: {
        role: 'user',
        content: texted('law'),
        metadata: { origin: 'guidance', runtimeState: { 'project-instructions': snapshot } },
      },
    });
    const told = yield* units.read((unit) => history.toldTail(unit, id, instructionsTold(1)));
    const indexed = yield* units.read((unit) => history.toldState(unit, id, instructionsTold(1)));
    return { snapshot: instructionSnapshot(told ?? [], 1), indexed: indexed?.value };
  });
  return Effect.map(read.pipe(Effect.provide(layer)), (answered) => expect(answered).toEqual({ snapshot, indexed: snapshot }));
});

it.live('a history read back from the store is metered by its stored measure, not by serializing its messages', () =>
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    const kinds = makeThreadEntryReader({ products: [] });
    const id = 'history-measure';
    yield* bornThread(store.db, { id, ownerId: 'owner', agentId: 'agent', spawnRootId: id, authority: THREAD_AUTHORITY_DEFAULT });
    yield* store.db.insert(threadLog).values({ threadId: id });
    const messages = [Message.make({ role: 'user', content: 'asked' }), Message.make({ role: 'assistant', content: 'told' })];
    const writer = yield* historyOf(kinds);
    yield* units.write(changed, (unit) => writer.write(unit, id, messages, 0));
    const restarted = yield* historyOf(kinds);
    const loaded = yield* units.read((unit) => restarted.read(unit, id));
    if (loaded === null) return yield* Effect.die(new Error('history was not read'));
    const fresh = structuredClone(loaded);
    let reads = 0;
    for (const message of loaded) {
      const content = message.content;
      Object.defineProperty(message, 'content', {
        get: () => {
          reads += 1;
          return content;
        },
      });
    }
    const request = (history: typeof loaded) =>
      new ThreadRequestMeter().requestHashed({ system: undefined, messages: history, tools: [], providerOptions: undefined }, 0);
    const metered = yield* request(loaded);
    expect(reads).toBe(0);
    expect(metered).toEqual(yield* request(fresh));
  }).pipe(Effect.provide(layer)),
);

it.live('a silent projection advances the cursor without re-reading retained messages', () => exercise(false).pipe(Effect.provide(layer)));

it.live('a rolled-back silent projection preserves the prior cursor and history', () => exercise(true).pipe(Effect.provide(layer)));
