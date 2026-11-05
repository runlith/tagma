import { expect } from 'bun:test';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Clock, Context, Effect, Option, Schema, Stream } from 'effect';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { ThreadFeeds } from '../../../threads/contract/service/feeds.js';
import { threadWireFeedEventSchema } from '../../../threads/contract/wire/snapshot.js';
import { birthsOf, rolloutsOf, threadEntry, threadEvent } from '../../../threads/testing/doubles.js';
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

const statesOf = (entry: Record<string, unknown> | undefined): readonly unknown[] =>
  (entry?.toolDisplay as { items: readonly { state: unknown }[] }).items.map((item) => item.state);

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
