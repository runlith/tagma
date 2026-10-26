import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { sql } from 'drizzle-orm';
import { Context, Duration, Effect, FileSystem, Layer } from 'effect';
import { layer } from '@runlith/effect-test';
import { Message } from '@runlith/llm/schema/messages';
import type { ThreadEventBody } from '@runlith/agent/thread/events';
import { toolEntryId, userMessageEntryId } from '@runlith/agent/transcript/entryNames';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { ThreadToolEntry } from '@runlith/agent/transcript/entries';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { Conversations } from '../../../threads/contract/service/conversations.js';
import { NativeStorage, ThreadHarness } from '../../../threads/contract/service/engine.js';
import { ThreadRollouts } from '../../../threads/contract/service/rollouts.js';
import { ToolOutputs } from '../../../native-harness/contract/service/toolOutputs.js';
import { birthsOf, rewindsOf, sqliteThreadJournal, turnsOf } from '../../../threads/testing/doubles.js';
import { makeDoorWorld, projectLeaving } from '../doorFixture.js';
import { WIRE_ENTRY_MAX_BYTES } from '@runlith/agent/protocol/cap';
import { maintenancePasses } from '../../../native-harness/testing/doubles.js';

const makeWorld = Effect.gen(function* () {
  const world = yield* makeDoorWorld();
  const projectId = yield* world.stealthProject();
  yield* projectLeaving(world, projectId);
  const runtime = world.runtime;
  const journal = yield* sqliteThreadJournal().pipe(Effect.provide(runtime.graph));
  return { runtime, projectId, data: world.dataHome, journal };
});

class World extends Context.Service<World, Effect.Success<typeof makeWorld>>()('testing/ForkPrefixWorld') {}

const at = (turn: number) => new Date(Date.UTC(2026, 9, 1, 8, turn)).toISOString();

const said = (turn: number, role: 'user' | 'assistant', text: string): ThreadEventBody => ({
  kind: 'message',
  payload: {
    entry: {
      type: 'message',
      id: role === 'user' ? userMessageEntryId(`run-${turn}`) : `message:assistant:run-${turn}`,
      runId: `run-${turn}`,
      role,
      text,
      occurredAt: at(turn),
    },
    messages: [role === 'user' ? Message.user(text) : Message.assistant(text)],
  },
});

const called = (turn: number, state: 'input-available' | 'output-available'): ThreadEventBody => {
  const entry: ThreadTranscriptEntry = {
    type: 'tool',
    id: toolEntryId(`call-${turn}`),
    runId: `run-${turn}`,
    toolName: 'read',
    toolCallId: `call-${turn}`,
    toolState: state,
    toolInput: { path: `file-${turn}.ts` },
    ...(state === 'output-available' ? { toolOutput: { text: `the body of file ${turn}` } } : {}),
    occurredAt: at(turn),
  };
  return { kind: 'tool', payload: { entry } };
};

const measured = (step: number): ThreadEventBody =>
  ({
    kind: 'measurement',
    payload: {
      measurement: {
        runId: 'run-1',
        stepNumber: step,
        attempt: 0,
        provider: 'subscription',
        model: 'claude-opus-5-5',
        usage: { inputTokens: 1000 + step, outputTokens: 7, totalTokens: 1007 + step },
        contextWindow: 200_000,
        inputLimit: null,
        measuredAt: `2026-09-14T10:0${step}:00.000Z`,
        sentAt: `2026-09-14T10:0${step}:00.000Z`,
        footprint: { messages: step + 1, messageDigest: `message-${step}`, promptDigest: 'prompt', toolDigests: [`${step}`.repeat(64)] },
      },
    },
  }) as unknown as ThreadEventBody;

const turn = (n: number) => [
  said(n, 'user', `question about the quokka ${n}`),
  called(n, 'input-available'),
  said(n, 'assistant', `answer ${n}`),
];

const seen = Effect.fnUntraced(function* (threadId: string) {
  const { runtime, journal } = yield* World;
  const transcript = (yield* Context.get(runtime.owners, NativeStorage).threads.transcriptOf(threadId)) ?? [];
  const events = yield* journal.eventsAfter(threadId, 0, 10_000);
  return { transcript, events: events.map((row) => ({ position: row.position, kind: row.kind, payload: row.payload })) };
});

const sourceOf = Effect.fnUntraced(function* (title: string, turns: number) {
  const { runtime, projectId } = yield* World;
  const source = (yield* birthsOf(runtime.owners).create({ projectId, createdBySessionId: null, title })).thread.id;
  const handle = Context.get(runtime.owners, ThreadHarness).threads.handle(source, OPERATOR_PRINCIPAL);
  yield* handle.append(Array.from({ length: turns }, (_, n) => turn(n + 1)).flat());
  return { source, append: (events: readonly ThreadEventBody[]) => handle.append(events) };
});

const branchOf = Effect.fnUntraced(function* (source: string) {
  const { runtime, projectId } = yield* World;
  return (yield* rewindsOf(runtime.owners).branch(source, projectId, {})).threadId;
});

const count = Effect.fnUntraced(function* (table: 'thread_event' | 'thread_entry' | 'thread_message', threadId: string) {
  const { runtime } = yield* World;
  const [row] = yield* Context.get(runtime.graph, MachineStore).db.all<{ n: number }>(
    sql`select count(*) as n from ${sql.identifier(table)} where thread_id = ${threadId}`,
  );
  return row?.n ?? 0;
});

layer(Layer.effect(World, makeWorld).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true, timeout: '60 seconds' })(
  'a branch over its source’s prefix',
  (it) => {
    it.effect('holds no copy of the prefix, and the source settling, rewinding and going on leaves the branch as it was born', () =>
      Effect.gen(function* () {
        const { runtime, projectId } = yield* World;
        const { source, append } = yield* sourceOf('rewound source', 3);
        const child = yield* branchOf(source);
        const born = yield* seen(child);
        expect(born.transcript.map((entry) => entry.id)).toEqual((yield* seen(source)).transcript.map((entry) => entry.id));
        expect([yield* count('thread_event', child), yield* count('thread_entry', child)]).toEqual([0, 0]);
        yield* append([called(2, 'output-available')]);
        yield* rewindsOf(runtime.owners).rewind(source, projectId, { at: 'run-3', scope: 'turn' });
        yield* append([...turn(4), { kind: 'withdrawal', payload: { withdrawn: { runId: 'run-1', keepMessages: 0 } } }]);
        const later = yield* seen(source);
        expect(later.transcript.some((entry) => entry.runId === 'run-1')).toBe(false);
        expect(later.transcript.find((entry) => entry.id === toolEntryId('call-2'))).toMatchObject({ toolState: 'output-available' });
        expect(later.transcript.find((entry) => entry.id === userMessageEntryId('run-3'))?.rewound).toBeDefined();
        expect(yield* seen(child)).toEqual(born);
      }),
    );

    it.effect('maintenance over the source’s prefix leaves the branch reading the same values', () =>
      Effect.gen(function* () {
        const { runtime } = yield* World;
        const { source, append } = yield* sourceOf('maintained source', 1);
        const value = { text: 'w'.repeat(WIRE_ENTRY_MAX_BYTES + 10) };
        yield* append([
          {
            kind: 'tool',
            payload: { entry: { ...(called(1, 'output-available').payload.entry as ThreadToolEntry), toolOutput: value } },
          },
          measured(1),
          measured(2),
        ]);
        const child = yield* branchOf(source);
        const born = yield* seen(child);
        yield* append([measured(3)]);
        const context = Context.merge(runtime.graph, runtime.owners);
        const passes = yield* maintenancePasses.pipe(Effect.provide(context));
        yield* passes.stripping.pass();
        yield* passes.bounding.pass();
        yield* passes.footprints.pass();
        const later = yield* seen(child);
        expect(later.transcript.length).toBe(born.transcript.length);
        const tool = later.transcript.find((entry) => entry.id === toolEntryId('call-1')) as { toolOutput?: { outputId?: string } };
        const pointer = tool.toolOutput?.outputId ?? '';
        expect(yield* count('thread_entry', child)).toBe(0);
        expect(yield* Context.get(runtime.owners, ToolOutputs).store.retained(child, pointer)).toEqual({ value });
        const footprints = (events: typeof born.events) =>
          events.flatMap((event) => (event.kind === 'measurement' ? [JSON.stringify(event.payload).includes('toolDigests')] : []));
        expect(footprints(later.events).at(-1)).toBe(true);
        expect(later.events.filter((event) => event.kind !== 'measurement' && event.kind !== 'tool')).toEqual(
          born.events.filter((event) => event.kind !== 'measurement' && event.kind !== 'tool'),
        );
      }),
    );

    it.effect('a branch of a branch reads both prefixes, and its own writes leave its parent untouched', () =>
      Effect.gen(function* () {
        const { runtime, projectId } = yield* World;
        const { source } = yield* sourceOf('grandparent', 2);
        const middle = yield* branchOf(source);
        const handle = Context.get(runtime.owners, ThreadHarness).threads.handle(middle, OPERATOR_PRINCIPAL);
        yield* handle.append([...turn(3), called(1, 'output-available')]);
        const parent = yield* seen(middle);
        const child = yield* branchOf(middle);
        expect((yield* seen(child)).transcript).toEqual(parent.transcript);
        yield* rewindsOf(runtime.owners).rewind(child, projectId, { at: 'run-1', scope: 'from' });
        expect(yield* seen(middle)).toEqual(parent);
        expect((yield* seen(child)).transcript.find((entry) => entry.id === userMessageEntryId('run-1'))?.rewound).toBeDefined();
        yield* Context.get(runtime.owners, ThreadHarness)
          .threads.handle(child, OPERATOR_PRINCIPAL)
          .append([{ kind: 'withdrawal', payload: { withdrawn: { runId: 'run-1', keepMessages: 0 } } }]);
        expect((yield* seen(child)).transcript.some((entry) => entry.runId === 'run-1')).toBe(false);
        expect(yield* seen(middle)).toEqual(parent);
      }),
    );

    it.effect('a branch cut before a turn rewinds the turns it kept', () =>
      Effect.gen(function* () {
        const { runtime, projectId } = yield* World;
        const { source } = yield* sourceOf('cut source', 3);
        const rewinds = rewindsOf(runtime.owners);
        const child = (yield* rewinds.branch(source, projectId, { before: 'run-3' })).threadId;
        expect((yield* seen(child)).transcript.some((entry) => entry.runId === 'run-3')).toBe(false);
        expect((yield* rewinds.rewind(child, projectId, { at: 'run-1', scope: 'turn' })).runIds).toEqual(['run-1']);
        expect((yield* seen(child)).transcript.find((entry) => entry.id === userMessageEntryId('run-2'))?.rewound).toBeUndefined();
      }),
    );

    it.effect(
      'the prefix’s words stay found in the branch after the source takes them back, and a search over all threads finds the branch',
      () =>
        Effect.gen(function* () {
          const { runtime } = yield* World;
          const { source, append } = yield* sourceOf('searched source', 2);
          const child = yield* branchOf(source);
          const conversations = Context.get(runtime.owners, Conversations);
          const heard = (query: string, threadId?: string) =>
            Effect.map(
              conversations.search(
                { kind: 'operator' },
                { scope: { kind: 'all', removed: [] }, limit: 50, query, ...(threadId === undefined ? {} : { threadId }) },
              ),
              (page) => page.matches.map((hit) => [hit.threadId, hit.match.entryId] as const),
            );
          expect(
            (yield* heard('answer 2'))
              .filter(([threadId]) => threadId === source || threadId === child)
              .map(([id]) => id)
              .sort(),
          ).toEqual([source, child].sort());
          yield* append([{ kind: 'withdrawal', payload: { withdrawn: { runId: 'run-2', keepMessages: 0 } } }]);
          expect(yield* heard('answer 2', source)).toEqual([]);
          expect(yield* heard('answer 2', child)).toEqual([[child, 'message:assistant:run-2']]);
          expect((yield* heard('answer 2')).filter(([threadId]) => threadId === source || threadId === child)).toEqual([
            [child, 'message:assistant:run-2'],
          ]);
        }),
    );

    it.effect('finds the prefix’s words in the branch, and deleting the source leaves the branch whole with its prefix outputs', () =>
      Effect.gen(function* () {
        const { runtime, data } = yield* World;
        const files = yield* FileSystem.FileSystem;
        const { source } = yield* sourceOf('deleted source', 2);
        const outputs = Context.get(runtime.owners, ToolOutputs).store;
        const kept = yield* Effect.promise(() => outputs.write(source, JSON.stringify({ kept: 'by the source' })));
        const child = yield* branchOf(source);
        const found = Effect.map(
          Context.get(runtime.owners, Conversations).search(
            { kind: 'operator' },
            { scope: { kind: 'all', removed: [] }, limit: 20, query: 'quokka 2', threadId: child },
          ),
          (page) => page.matches.map((hit) => hit.match.entryId),
        );
        expect(yield* found).toEqual([userMessageEntryId('run-2')]);
        expect(yield* count('thread_message', child)).toBe(0);
        const born = yield* seen(child);
        const harness = Context.get(runtime.owners, ThreadHarness).threads;
        expect(yield* harness.handle(source, OPERATOR_PRINCIPAL).delete(Duration.seconds(10))).toBe(true);
        expect(yield* seen(child)).toEqual(born);
        expect(yield* found).toEqual([userMessageEntryId('run-2')]);
        expect(yield* outputs.retained(child, kept.outputId)).toEqual({ value: { kept: 'by the source' } });
        expect(yield* harness.handle(child, OPERATOR_PRINCIPAL).delete(Duration.seconds(10))).toBe(true);
        expect(yield* files.exists(kept.path)).toBe(false);
        void data;
      }),
    );

    it.effect(
      'a branch and its source both rest with no journal rows, and the branch returns alone with its feed, rewind points and words',
      () =>
        Effect.gen(function* () {
          const { runtime, projectId } = yield* World;
          const { source } = yield* sourceOf('resting source', 2);
          const child = (yield* rewindsOf(runtime.owners).branch(source, projectId, { before: 'run-2' })).threadId;
          yield* Context.get(runtime.owners, ThreadHarness).threads.handle(child, OPERATOR_PRINCIPAL).append(turn(3));
          const born = yield* seen(child);
          const points = yield* rewindsOf(runtime.owners).points(child, projectId);
          const conversations = Context.get(runtime.owners, Conversations);
          const heard = Effect.map(
            conversations.search(
              { kind: 'operator' },
              { scope: { kind: 'all', removed: [] }, limit: 20, query: 'quokka', threadId: child },
            ),
            (page) => page.matches.map((hit) => hit.match.entryId),
          );
          const words = yield* heard;
          const rollouts = Context.get(runtime.owners, ThreadRollouts);
          const rows = Effect.all([
            count('thread_event', source),
            count('thread_entry', source),
            count('thread_event', child),
            count('thread_entry', child),
          ]);
          expect((yield* rollouts.evict(projectId, child)).outcome).toBe('evicted');
          expect((yield* rollouts.evict(projectId, source)).outcome).toBe('evicted');
          expect(yield* rows).toEqual([0, 0, 0, 0]);
          expect(yield* heard).toEqual(words);
          yield* rollouts.rehydrate(child);
          expect(yield* seen(child)).toEqual(born);
          expect(yield* rewindsOf(runtime.owners).points(child, projectId)).toEqual(points);
          expect(yield* heard).toEqual(words);
          expect([yield* count('thread_event', source), yield* count('thread_entry', source)]).toEqual([0, 0]);
        }),
    );

    it.effect('a source rests under a live branch by handing it the prefix, and the branch reads on as before', () =>
      Effect.gen(function* () {
        const { runtime, projectId } = yield* World;
        const { source } = yield* sourceOf('handing source', 2);
        const child = yield* branchOf(source);
        const born = yield* seen(child);
        const rollouts = Context.get(runtime.owners, ThreadRollouts);
        expect((yield* rollouts.evict(projectId, source)).outcome).toBe('evicted');
        expect([yield* count('thread_event', source), yield* count('thread_entry', source)]).toEqual([0, 0]);
        expect(yield* seen(child)).toEqual(born);
        expect(yield* seen(yield* branchOf(child))).toEqual(born);
        yield* Context.get(runtime.owners, ThreadHarness).threads.handle(child, OPERATOR_PRINCIPAL).append(turn(3));
        expect((yield* seen(child)).transcript.length).toBe(born.transcript.length + 3);
      }),
    );
  },
);
