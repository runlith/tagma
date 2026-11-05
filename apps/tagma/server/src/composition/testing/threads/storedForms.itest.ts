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

    expect((yield* snapshotOf(projectId, damaged.authority))?.thread.authority).toEqual({ mode: 'review', bypassFrom: null });
    expect((yield* snapshotOf(projectId, damaged.transport))?.thread.transport).toEqual({
      adapter: 'unreadable',
      profile: null,
      agent: null,
    });
    expect((yield* snapshotOf(projectId, damaged.capabilities))?.thread.capabilities).toMatchObject({ history: 'none', continue: false });
    expect(yield* snapshotOf(projectId, damaged.bornOf)).not.toBeNull();

    expect(yield* toldOf(damaged.authority)).toContainEqual(expect.stringContaining('thread row: Thread'));
    expect(yield* toldOf(damaged.transport)).toContainEqual(expect.stringContaining('transport binding cannot be read'));
    expect(yield* toldOf(damaged.capabilities)).toContainEqual(expect.stringContaining('transport capabilities cannot be read'));
    expect(yield* toldOf(damaged.bornOf)).toEqual([expect.stringContaining('born-of cannot be read')]);

    const unreleased = yield* Effect.exit(
      Effect.provide(turnsOf(world.runtime.owners).delete(damaged.transport, projectId), world.runtime.owners),
    );
    expect(Exit.isFailure(unreleased)).toBe(true);
    yield* db.run(sql`update native_thread set transport = ${JSON.stringify(NATIVE_BINDING)} where id = ${damaged.transport}`);
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
