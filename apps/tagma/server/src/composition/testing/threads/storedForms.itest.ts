import { expect } from 'bun:test';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ActivityStore } from '@runlith/activity/store';
import { it } from '@runlith/effect-test';
import { Clock, Context, Effect, Exit, Option, Schema, Stream } from 'effect';
import { ThreadEntryKinds, ThreadEntryUnreadable } from '@runlith/agent/transcript/kinds';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { and, eq, sql } from 'drizzle-orm';
import { nativeOnlyParts } from '../../../native-harness/testing/rollout.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { ThreadFeeds } from '../../../threads/contract/service/feeds.js';
import { threadsFeedEventSchema } from '../../../threads/contract/wire/list.js';
import { threadWireFeedEventSchema } from '../../../threads/contract/wire/snapshot.js';
import {
  birthsOf,
  exportThreadRollout,
  rolloutsOf,
  threadEntry,
  threadEvent,
  threadRun,
  turnsOf,
} from '../../../threads/testing/doubles.js';
import { NATIVE_BINDING } from '@runlith/agent/thread/record';
import { restFor } from '../../../threads/testing/rest.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { harnessFacet } from '../../../threads/contract/wire/harness/types.js';
import { isTransportEntry } from '../../../threads/contract/wire/harness/transportEntry.js';
import { harnessPresentation } from '../../../external-harnesses/contract/service/table.js';
import { builtinHarness } from '../../../external-harnesses/testing/builtin.js';
import { terminalKernel } from '../../../external-harnesses/testing/doubles.js';
import { threadStack } from '../threadParts.js';
import { windowChannel } from './windowChannel.js';
import { ENTRY_KINDS } from '../composed.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';

const fixture = doorFixture();

const askedBeforeTheCut = (threadId: string, call: string) => ({
  type: 'tool',
  id: `tool:${threadId}:${call}`,
  runId: threadId,
  toolName: 'ask',
  toolCallId: call,
  toolState: 'output-available',
  toolInput: { questions: ['first', 'second'] },
  toolOutput: {
    status: 'asked',
    entries: [
      { question: 'first', status: 'answered', text: 'whole', evidence: ['a.ts:1'], threadId: 'reader-1' },
      { question: 'second', status: 'partial', text: 'in part', evidence: [], missing: 'the rest', threadId: 'reader-2' },
    ],
  },
  toolDisplay: {
    form: 'list',
    verb: 'Asked',
    title: '2 questions',
    items: [
      { label: 'first', detail: 'whole', state: 'answered', thread: { id: 'reader-1' } },
      { label: 'second', detail: 'in part', state: 'partial', thread: { id: 'reader-2' } },
    ],
  },
});

const opened = Effect.fnUntraced(function* (projectId: number, threadId: string) {
  const world = yield* DoorFixture;
  const frame = yield* Stream.runHead(Context.get(world.runtime.owners, ThreadFeeds)['thread.subscribe']({ projectId, threadId }));
  const crossed = yield* Schema.encodeEffect(threadWireFeedEventSchema)(Option.getOrThrow(frame)).pipe(
    Effect.provideService(ThreadEntryKinds, ENTRY_KINDS),
  );
  return (JSON.parse(JSON.stringify(crossed)) as { payload: { snapshot: { transcript: readonly Record<string, unknown>[] } } }).payload
    .snapshot.transcript;
});

const snapshotOf = Effect.fnUntraced(function* (projectId: number, threadId: string) {
  const world = yield* DoorFixture;
  const frame = yield* Stream.runHead(Context.get(world.runtime.owners, ThreadFeeds)['thread.subscribe']({ projectId, threadId }));
  const sent = yield* Schema.encodeEffect(threadWireFeedEventSchema)(Option.getOrThrow(frame)).pipe(
    Effect.provideService(ThreadEntryKinds, ENTRY_KINDS),
  );
  const read = yield* Schema.decodeUnknownEffect(threadWireFeedEventSchema)(JSON.parse(JSON.stringify(sent))).pipe(
    Effect.provideService(ThreadEntryKinds, ENTRY_KINDS),
  );
  return read.type === 'snapshot' ? read.payload.snapshot : null;
});

const onWire = (projectId: number, threadId: string) =>
  Effect.map(snapshotOf(projectId, threadId), (snapshot) => snapshot?.transcript ?? []);

type Told = { readonly place: string; readonly message: string; readonly thread: string | null };

const told = Effect.fnUntraced(function* () {
  const world = yield* DoorFixture;
  yield* Context.get(world.runtime.owners, ActivityStore).settled;
  const { body } = yield* world.op('read_faults', {});
  return (body as { faults: readonly Told[] }).faults;
});

const errorsAt = (place: string) =>
  Effect.map(told(), (faults) => faults.filter((fault) => fault.place === place).map((fault) => fault.message));

const toldOf = (thread: string) =>
  Effect.map(told(), (faults) => faults.filter((fault) => fault.thread === thread).map((fault) => `${fault.place}: ${fault.message}`));

const shownIn = (transcript: readonly ThreadTranscriptEntry[]) => transcript.map((entry) => `${entry.type} ${entry.id}`);

const statesOf = (entry: Record<string, unknown> | undefined): readonly unknown[] =>
  (entry?.toolDisplay as { items: readonly { state: unknown }[] }).items.map((item) => item.state);

it.live('an entry no build reads stays one line among its neighbours, and resting and returning the thread keeps its stored body', () =>
  Effect.gen(function* () {
    const world = yield* DoorFixture;
    const projectId = yield* world.stealthProject();
    yield* projectLeaving(world, projectId);
    const store = Context.get(world.runtime.graph, MachineStore);
    const { db } = store;
    const id = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null })).thread.id;
    const rollouts = rolloutsOf(world.runtime.owners);
    yield* rollouts.ensure(id);
    const said = (word: string) => ({ type: 'message', id: `${id}:${word}`, runId: id, role: 'user', text: word });
    const damaged = {
      type: 'tool',
      id: `tool:${id}:call`,
      runId: id,
      toolName: 'read',
      toolCallId: 'call',
      toolState: 'a-state-no-build-declares',
      toolOutput: { kept: 'whole' },
    };
    const facts = [said('before'), damaged, said('after')];
    yield* db.insert(threadEvent()).values(
      facts.map((entry, at) => ({
        threadId: id,
        position: at + 1,
        id: `${id}:${at}`,
        kind: entry.type,
        payload: { entry },
      })),
    );
    const expected = [`message ${id}:before`, `entry-unreadable ${damaged.id}`, `message ${id}:after`];

    const pending = yield* onWire(projectId, id);
    expect(shownIn(pending)).toEqual(expected);
    expect(pending[1]).toBeInstanceOf(ThreadEntryUnreadable);
    expect((pending[1] as ThreadEntryUnreadable).refusal).toMatchObject({ type: 'tool', id: damaged.id });
    expect(yield* errorsAt('thread entry')).toEqual([expect.stringContaining('kind tool cannot be read')]);

    yield* exportThreadRollout({
      threadId: id,
      path: join(world.dataHome, 'threads', String(projectId), `${id}.jsonl`),
      parts: yield* nativeOnlyParts,
    }).pipe(Effect.provideService(MachineStore, store), Effect.provideService(ThreadEntryKinds, ENTRY_KINDS));
    expect((yield* rollouts.evict(projectId, id)).outcome).toBe('evicted');
    expect(shownIn(yield* onWire(projectId, id))).toEqual(expected);

    yield* rollouts.rehydrate(id);
    expect(shownIn(yield* onWire(projectId, id))).toEqual(expected);
    const [row] = yield* db
      .select({ type: threadEntry().type, entry: threadEntry().entry })
      .from(threadEntry())
      .where(and(eq(threadEntry().threadId, id), eq(threadEntry().entryId, damaged.id)));
    expect(row).toEqual({ type: 'tool', entry: damaged });
  }).pipe(Effect.scoped, Effect.provide(fixture)),
);

it.live('an event whose model messages or rewind no build reads leaves the transcript standing, in the store and at rest', () =>
  Effect.gen(function* () {
    const world = yield* DoorFixture;
    const projectId = yield* world.stealthProject();
    yield* projectLeaving(world, projectId);
    const store = Context.get(world.runtime.graph, MachineStore);
    const { db } = store;
    const id = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null })).thread.id;
    const rollouts = rolloutsOf(world.runtime.owners);
    yield* rollouts.ensure(id);
    const said = (word: string) => ({ type: 'message', id: `${id}:${word}`, runId: id, role: 'user', text: word });
    const payloads = [
      { entry: said('first'), messages: [{ role: 'oracle', content: 'a role no build reads' }] },
      { rewound: { id: 'rewind', scope: 'a scope no build reads', runIds: [id], cuts: [] } },
      { entry: said('last') },
    ];
    yield* db
      .insert(threadEvent())
      .values(
        payloads.map((payload, at) => ({ threadId: id, position: at + 1, id: `${id}:${at}`, kind: 'message', payload: payload as never })),
      );
    const expected = [`message ${id}:first`, `entry-unreadable ${id}:1`, `message ${id}:last`];

    expect(shownIn(yield* onWire(projectId, id))).toEqual(expected);

    const rested = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null })).thread.id;
    yield* rollouts.ensure(rested);
    const lines = payloads.map((payload, at) => ({
      kind: 'event',
      row: {
        threadId: rested,
        position: at + 1,
        id: `${rested}:${at}`,
        kind: 'message',
        payload: JSON.parse(JSON.stringify(payload).replaceAll(id, rested)),
      },
    }));
    yield* Effect.promise(() =>
      appendFile(
        join(world.dataHome, 'threads', String(projectId), `${rested}.jsonl`),
        `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
      ),
    );
    yield* restFor(db, rested, new Date(yield* Clock.currentTimeMillis));
    expect(shownIn(yield* onWire(projectId, rested))).toEqual([
      `message ${rested}:first`,
      `entry-unreadable ${rested}:1`,
      `message ${rested}:last`,
    ]);
    expect(yield* errorsAt('thread entry')).toContainEqual(expect.stringContaining('cannot be placed in the transcript'));
  }).pipe(Effect.scoped, Effect.provide(fixture)),
);

it.live('one thread whose row does not read leaves the list standing and is told to the error list', () =>
  Effect.gen(function* () {
    const world = yield* DoorFixture;
    const projectId = yield* world.stealthProject();
    yield* projectLeaving(world, projectId);
    const { db } = Context.get(world.runtime.graph, MachineStore);
    const births = birthsOf(world.runtime.owners);
    const standing = (yield* births.create({ projectId, createdBySessionId: null })).thread.id;
    const damaged = (yield* births.create({ projectId, createdBySessionId: null })).thread.id;
    yield* db.run(sql`update native_thread set context_reading = ${'{"oops":1}'} where id = ${damaged}`);
    yield* db.insert(threadRun()).values({
      id: `${damaged}:run`,
      threadId: damaged,
      ownerId: 'operator',
      status: 'failed',
      finishedAt: new Date(yield* Clock.currentTimeMillis),
    });
    yield* db.run(sql`update thread_run set failure = ${'{"oops":1}'}, stream_tail = ${'{"oops":1}'} where id = ${`${damaged}:run`}`);
    const frame = yield* Stream.runHead(Context.get(world.runtime.owners, ThreadFeeds)['threads.subscribe']({ projectId }));
    const listed = Option.getOrThrow(frame);
    expect(listed.type === 'list' ? listed.rows.map((row) => row.id).toSorted() : []).toEqual([standing, damaged].toSorted());
    yield* Schema.encodeEffect(threadsFeedEventSchema)(listed);
    expect(shownIn(yield* onWire(projectId, damaged))).toEqual([]);
    const reported = yield* errorsAt('thread row');
    expect(reported).toContainEqual(expect.stringContaining('context reading cannot be read'));
    expect(reported).toContainEqual(expect.stringContaining('run failure cannot be read'));
    expect(reported).toContainEqual(expect.stringContaining('stream tail cannot be read'));
  }).pipe(Effect.scoped, Effect.provide(fixture)),
);

it.live('a thread whose authority, transport, capabilities or birth does not read stays listed, opens and is told', () =>
  Effect.gen(function* () {
    const world = yield* DoorFixture;
    const projectId = yield* world.stealthProject();
    yield* projectLeaving(world, projectId);
    const { db } = Context.get(world.runtime.graph, MachineStore);
    const births = birthsOf(world.runtime.owners);
    const born = Effect.map(births.create({ projectId, createdBySessionId: null }), (made) => made.thread.id);
    const standing = yield* born;
    const damaged = { authority: yield* born, transport: yield* born, capabilities: yield* born, bornOf: yield* born };
    const broken = '{"oops":1}';
    yield* db.run(sql`update thread_mandate set authority = ${broken} where id = ${damaged.authority}`);
    yield* db.run(sql`update native_thread set transport = ${broken} where id = ${damaged.transport}`);
    yield* db.run(sql`update native_thread set capabilities = ${broken} where id = ${damaged.capabilities}`);
    yield* db.run(sql`update thread set born_of = ${broken} where id = ${damaged.bornOf}`);
    const frame = yield* Stream.runHead(Context.get(world.runtime.owners, ThreadFeeds)['threads.subscribe']({ projectId }));
    const listed = Option.getOrThrow(frame);
    expect(listed.type === 'list' ? listed.rows.map((row) => row.id).toSorted() : []).toEqual(
      [standing, ...Object.values(damaged)].toSorted(),
    );
    yield* Schema.encodeEffect(threadsFeedEventSchema)(listed);

    expect((yield* snapshotOf(projectId, damaged.authority))?.thread).toMatchObject({
      authority: { mode: 'review', bypassFrom: null },
      unread: ['authority'],
    });
    expect((yield* snapshotOf(projectId, damaged.transport))?.thread.unread).toEqual(['transport']);
    expect((yield* snapshotOf(projectId, damaged.capabilities))?.thread).toMatchObject({
      capabilities: { history: 'none', continue: false },
      unread: ['capabilities'],
    });
    expect((yield* snapshotOf(projectId, damaged.bornOf))?.thread.unread).toBeUndefined();

    expect(yield* toldOf(damaged.authority)).toContainEqual(expect.stringContaining('thread row: Thread'));
    expect(yield* toldOf(damaged.transport)).toContainEqual(expect.stringContaining('transport binding cannot be read'));
    expect(yield* toldOf(damaged.capabilities)).toContainEqual(expect.stringContaining('transport capabilities cannot be read'));
    expect(yield* toldOf(damaged.bornOf)).toEqual([expect.stringContaining('born-of cannot be read')]);

    const project = `project=${projectId}`;
    expect((yield* world.op('restart_thread', { threadId: damaged.transport }, project)).body).toMatchObject({
      code: 'transport-cannot',
      reason: expect.stringContaining('did not read'),
    });
    expect((yield* world.op('delete_thread', { threadId: damaged.transport }, project)).body).toMatchObject({ status: 'deleted' });
  }).pipe(Effect.scoped, Effect.provide(fixture)),
);

it.live('text that is not JSON in a thread fact reads as a fact this build cannot read, in the list, the thread and the directory', () =>
  Effect.gen(function* () {
    const world = yield* DoorFixture;
    const projectId = yield* world.stealthProject();
    yield* projectLeaving(world, projectId);
    const { db } = Context.get(world.runtime.graph, MachineStore);
    const born = Effect.map(birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null }), (made) => made.thread.id);
    const torn = '{"oops":';
    const damaged = { authority: yield* born, transport: yield* born, bornOf: yield* born, reading: yield* born, ended: yield* born };
    const live = yield* born;
    yield* db.run(sql`update thread_mandate set authority = ${torn} where id = ${damaged.authority}`);
    yield* db.run(sql`update native_thread set transport = ${torn} where id = ${damaged.transport}`);
    yield* db.run(sql`update thread set born_of = ${torn} where id = ${damaged.bornOf}`);
    yield* db.run(sql`update native_thread set context_reading = ${torn} where id = ${damaged.reading}`);
    const finishedAt = new Date(yield* Clock.currentTimeMillis);
    yield* db.insert(threadRun()).values([
      { id: `${damaged.ended}:run`, threadId: damaged.ended, ownerId: 'operator', status: 'failed', finishedAt },
      { id: `${live}:run`, threadId: live, ownerId: 'operator', status: 'running' },
    ]);
    yield* db.run(
      sql`update thread_run set failure = ${torn}, stream_tail = ${torn}, usage = ${torn}, progress = ${torn} where id = ${`${damaged.ended}:run`}`,
    );
    yield* db.run(sql`update thread_run set progress = ${torn} where id = ${`${live}:run`}`);

    const frame = yield* Stream.runHead(Context.get(world.runtime.owners, ThreadFeeds)['threads.subscribe']({ projectId }));
    const listed = Option.getOrThrow(frame);
    expect(listed.type === 'list' ? listed.rows.map((row) => row.id).toSorted() : []).toEqual([...Object.values(damaged), live].toSorted());
    yield* Schema.encodeEffect(threadsFeedEventSchema)(listed);

    expect((yield* snapshotOf(projectId, damaged.authority))?.thread.unread).toEqual(['authority']);
    expect((yield* snapshotOf(projectId, damaged.transport))?.thread.unread).toEqual(['transport']);
    expect((yield* snapshotOf(projectId, damaged.bornOf))?.thread.bornOf).toBeNull();
    expect((yield* snapshotOf(projectId, damaged.reading))?.thread.contextReading).toBeNull();
    expect(yield* snapshotOf(projectId, damaged.ended)).not.toBeNull();
    expect(yield* snapshotOf(projectId, live)).not.toBeNull();
    expect(yield* toldOf(damaged.bornOf)).toEqual([expect.stringContaining('born-of cannot be read')]);
    expect(yield* toldOf(damaged.transport)).toContainEqual(expect.stringContaining('transport binding cannot be read'));

    const agents = yield* world.op('list_agents', { limit: 139 }, `project=${projectId}`, { [GRANT_HEADER]: grantFor(live) });
    expect(JSON.stringify(agents.body)).toContain(damaged.transport);
    expect(yield* toldOf(live)).toContainEqual(expect.stringContaining('run progress cannot be read'));
    yield* db.run(sql`update thread_run set status = 'cut', finished_at = ${finishedAt.getTime()} where id = ${`${live}:run`}`);
  }).pipe(Effect.scoped, Effect.provide(fixture)),
);

it.live(
  'a transport or capabilities that did not read are told as such to every reader, and set_thread_transport stores a road again',
  () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const projectId = yield* world.stealthProject();
      yield* projectLeaving(world, projectId);
      const { db } = Context.get(world.runtime.graph, MachineStore);
      const units = Context.get(world.runtime.graph, MachineUnits);
      const context = yield* world.runtime.runtime.contextEffect;
      const records = yield* Effect.provide(makeThreadRecords, context);
      const { store, threads } = yield* Effect.provide(threadStack({ db, units, records, kinds: ENTRY_KINDS }), context);
      const cli = yield* units.write('storedForms.harnessThread', (unit) =>
        Effect.gen(function* () {
          const row = yield* store.insert({ ownerId: OPERATOR_PRINCIPAL, agentId: 'harness' }, unit);
          yield* threads.rows.attachFacet(
            {
              threadId: row.id,
              projectId,
              harness: {
                facet: harnessFacet('claude-code', harnessPresentation(builtinHarness('claude-code'))),
                kernel: terminalKernel(builtinHarness('claude-code'), undefined, false, {}),
              },
            },
            unit,
          );
          return row.id;
        }),
      );
      const native = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null })).thread.id;
      const broken = '{"oops":1}';
      yield* db.run(sql`update native_thread set transport = ${broken} where id = ${cli}`);
      yield* db.run(sql`update native_thread set capabilities = ${broken} where id = ${native}`);

      const frame = yield* Stream.runHead(Context.get(world.runtime.owners, ThreadFeeds)['threads.subscribe']({ projectId }));
      const listed = Option.getOrThrow(frame);
      const row = listed.type === 'list' ? listed.rows.find((each) => each.id === cli) : undefined;
      expect(row?.harness).toMatchObject({ name: 'claude-code', transport: null });

      const cannot = yield* world.op('read_rewind_points', { threadId: native }, `project=${projectId}`);
      expect(cannot.body).toMatchObject({
        code: 'transport-cannot',
        reason: expect.stringContaining('its stored transport capabilities did not read'),
      });
      expect((cannot.body as { readonly unblock: readonly string[] }).unblock.join(' ')).not.toContain('set_thread_transport');

      const moved = yield* world.op('set_thread_transport', { threadId: cli, transport: 'acp' }, `project=${projectId}`);
      expect(moved.body).toMatchObject({ status: 'switched', transport: 'acp' });
      const seated = yield* snapshotOf(projectId, cli);
      expect(seated?.thread).toMatchObject({ transport: { adapter: 'acp', profile: 'claude-code' } });
      expect(seated?.thread.unread).toBeUndefined();
      expect(seated?.transcript.filter(isTransportEntry).map((entry) => [entry.from, entry.to])).toEqual([[null, 'acp']]);

      yield* db.run(sql`update native_thread set capabilities = ${broken} where id = ${cli}`);
      const chosen = (yield* Context.get(world.runtime.owners, ProviderRegistry).catalog).defaultModel;
      const pinned = yield* world.op(
        'set_thread_model',
        { threadId: cli, provider: chosen?.provider ?? 'none', model: chosen?.model ?? 'none', reasoning: null, switches: {} },
        `project=${projectId}`,
      );
      expect(pinned.body).toMatchObject({ code: 'model-pinned', reason: expect.stringContaining('did not read') });
    }).pipe(Effect.scoped, Effect.provide(fixture)),
);

it.live('a steer on a thread whose transport did not read is not taken back as unsent', () =>
  Effect.gen(function* () {
    const world = yield* DoorFixture;
    const projectId = yield* world.stealthProject();
    yield* projectLeaving(world, projectId);
    const { db } = Context.get(world.runtime.graph, MachineStore);
    const id = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null })).thread.id;
    const run = `${id}:run`;
    yield* db.insert(threadRun()).values({ id: run, threadId: id, ownerId: 'operator', status: 'running' });
    const window = yield* windowChannel(world);
    const steered = yield* window['thread.steer']({
      projectId,
      threadId: id,
      params: { expectedRunId: run, text: 'later words', key: `${id}:steer` },
    });
    const inputId = 'itemId' in steered ? steered.itemId : '';
    yield* db.run(sql`update native_thread set transport = ${'{"oops":1}'} where id = ${id}`);

    const taken = yield* Effect.flip(window['thread.unqueue']({ projectId, threadId: id, params: { inputId } }));
    expect(taken).toMatchObject({ code: 'withdraw-failed', reason: expect.stringContaining('did not read') });
    yield* db.run(sql`update native_thread set transport = ${JSON.stringify(NATIVE_BINDING)} where id = ${id}`);
    yield* db.run(sql`update thread_run set status = 'cut', finished_at = ${yield* Clock.currentTimeMillis} where id = ${run}`);
  }).pipe(Effect.scoped, Effect.provide(fixture)),
);

it.live('a record that still does not read is told again once the error list is cleared', () =>
  Effect.gen(function* () {
    const world = yield* DoorFixture;
    const projectId = yield* world.stealthProject();
    yield* projectLeaving(world, projectId);
    const { db } = Context.get(world.runtime.graph, MachineStore);
    const id = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null })).thread.id;
    yield* db.run(sql`update native_thread set capabilities = ${'{"oops":1}'} where id = ${id}`);

    yield* snapshotOf(projectId, id);
    expect(yield* toldOf(id)).toEqual([expect.stringContaining('transport capabilities cannot be read')]);
    yield* world.op('clear_faults', {});
    expect(yield* toldOf(id)).toEqual([]);
    yield* snapshotOf(projectId, id);
    expect(yield* toldOf(id)).toEqual([expect.stringContaining('transport capabilities cannot be read')]);
  }).pipe(Effect.scoped, Effect.provide(fixture)),
);

it.live('an ask recorded with a partial answer opens whole from the store and from a rested rollout', () =>
  Effect.gen(function* () {
    const world = yield* DoorFixture;
    const projectId = yield* world.stealthProject();
    yield* projectLeaving(world, projectId);
    const { db } = Context.get(world.runtime.graph, MachineStore);
    const births = birthsOf(world.runtime.owners);

    const stored = (yield* births.create({ projectId, createdBySessionId: null })).thread.id;
    const folded = askedBeforeTheCut(stored, 'folded');
    const pending = askedBeforeTheCut(stored, 'pending');
    yield* db.insert(threadEntry()).values({ threadId: stored, ord: 0, entryId: folded.id, runId: stored, type: 'tool', entry: folded });
    yield* db.insert(threadEvent()).values({ threadId: stored, position: 1, id: pending.id, kind: 'tool', payload: { entry: pending } });
    const standing = yield* opened(projectId, stored);
    expect(standing.map((entry) => entry.id)).toEqual([folded.id, pending.id]);
    for (const entry of standing) expect(statesOf(entry)).toEqual(['answered', 'answered']);
    expect(standing[0]?.toolOutput).toEqual(folded.toolOutput);

    const rested = (yield* births.create({ projectId, createdBySessionId: null })).thread.id;
    yield* rolloutsOf(world.runtime.owners).ensure(rested);
    const asked = askedBeforeTheCut(rested, 'rested');
    const line = { kind: 'event', row: { threadId: rested, position: 1, id: asked.id, kind: 'tool', payload: { entry: asked } } };
    yield* Effect.promise(() =>
      appendFile(join(world.dataHome, 'threads', String(projectId), `${rested}.jsonl`), `${JSON.stringify(line)}\n`),
    );
    yield* restFor(db, rested, new Date(yield* Clock.currentTimeMillis));
    expect(statesOf((yield* opened(projectId, rested))[0])).toEqual(['answered', 'answered']);
  }).pipe(Effect.scoped, Effect.provide(fixture)),
);
