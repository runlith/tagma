import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { parseThreadStreamTail } from '@runlith/agent/thread/persisted';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { eq, sql } from 'drizzle-orm';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { birthsOf, rolloutsOf, threadEntry, threadEvent, threadRolloutForm, threadRun } from '../../../threads/testing/doubles.js';
import { makeDoorWorld } from '../doorFixture.js';
import { ENTRY_KINDS } from '../composed.js';

const setup = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const world = yield* makeDoorWorld({ drivers: ['rollout-shelving'], own: 'the test opens no maintenance gate' });
  const runtime = world.runtime;
  const projectId = yield* world.stealthProject();
  return { files, runtime, projectId, db: Context.get(runtime.graph, MachineStore).db };
});
class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/WholeCastWorld') {}

const law = { projectId: 1, root: '/project', complete: true, audience: 'graph', entries: [] };

const guidance = (threadId: string, form: 'old' | 'current') => ({
  type: 'runtime-guidance' as const,
  id: `guidance-${threadId}`,
  runId: `run-${threadId}`,
  hook: 'beforeStep' as const,
  sequence: 1,
  texts: ['law'],
  sources: [{ hook: 'beforeStep' as const, ruleId: 'prompt', state: { law: form === 'old' ? law : { '1': law } } }],
});

const lagging = Effect.fn('testing.laggingResident')(function* (title: string) {
  const { files, runtime, projectId, db } = yield* World;
  const rollouts = rolloutsOf(runtime.owners);
  const threadId = (yield* birthsOf(runtime.owners).create({ projectId, createdBySessionId: null, title })).thread.id;
  yield* rollouts.ensure(threadId);
  const path = (yield* rollouts.locate(threadId))!;
  const entry = guidance(threadId, 'old');
  const id = `event-${threadId}`;
  yield* files.writeFileString(
    path,
    `${JSON.stringify({ kind: 'event', row: { threadId, position: 1, id, kind: 'runtime-guidance', payload: { entry } } })}\n`,
    { flag: 'a' },
  );
  const bytes = Number((yield* files.stat(path)).size);
  yield* db.insert(threadEvent()).values({ threadId, position: 1, id, kind: 'runtime-guidance', payload: { entry } });
  yield* db.insert(threadEntry()).values({ threadId, ord: 0, entryId: entry.id, runId: entry.runId, type: 'runtime-guidance', entry });
  yield* db.insert(threadRun()).values({
    id: entry.runId,
    threadId,
    ownerId: 'operator',
    status: 'aborted',
    finishedAt: new Date(0),
    streamTail: [entry],
  });
  yield* db.run(sql`insert into thread_log (thread_id, history_through, entries_through) values (${threadId}, 1, 1)
    on conflict (thread_id) do update set history_through = 1, entries_through = 1`);
  yield* db.run(sql`update thread_rollout_cursor set next_byte_offset = ${bytes}, next_position = 2 where thread_id = ${threadId}`);
  const form = threadRolloutForm();
  yield* db.update(form).set({ step: null }).where(eq(form.threadId, threadId));
  return { threadId, path, entry };
});

const standing = Effect.fn('testing.standingRows')(function* (threadId: string, path: string) {
  const { files, db } = yield* World;
  const form = threadRolloutForm();
  const mark = yield* db.select({ step: form.step }).from(form).where(eq(form.threadId, threadId)).get();
  const events = yield* db.select({ payload: threadEvent().payload }).from(threadEvent()).where(eq(threadEvent().threadId, threadId));
  const entries = yield* db.select({ entry: threadEntry().entry }).from(threadEntry()).where(eq(threadEntry().threadId, threadId));
  const run = yield* db.select({ tail: threadRun().streamTail }).from(threadRun()).where(eq(threadRun().threadId, threadId)).get();
  return {
    step: mark?.step ?? null,
    events: events.map((row) => row.payload.entry),
    entries: entries.map((row) => row.entry),
    tail: parseThreadStreamTail(ENTRY_KINDS, run?.tail ?? null),
    stored: run?.tail ?? null,
    file: yield* files.readFileString(path),
  };
});

layer(Layer.effect(World, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('whole cast', (it) => {
  it.effect(
    'work continuing in a lagging resident thread casts it whole through its file; its unaccessed neighbour keeps its mark and bytes',
    () =>
      Effect.gen(function* () {
        const { runtime } = yield* World;
        const rollouts = rolloutsOf(runtime.owners);
        const cast = yield* lagging('the lagging thread');
        const neighbour = yield* lagging('the neighbour');
        const untouched = yield* standing(neighbour.threadId, neighbour.path);
        const before = yield* standing(cast.threadId, cast.path);
        expect(before.step).toBeNull();
        expect(before.tail).toEqual([guidance(cast.threadId, 'current')]);

        yield* rollouts.rehydrate(cast.threadId);

        const current = guidance(cast.threadId, 'current');
        const after = yield* standing(cast.threadId, cast.path);
        expect(after).toMatchObject({ step: ENTRY_KINDS.last, events: [current], entries: [current], tail: [current], stored: [current] });
        expect(after.file).toContain(JSON.stringify(current));
        expect(after.file).not.toContain(JSON.stringify(cast.entry));
        expect(yield* standing(neighbour.threadId, neighbour.path)).toEqual(untouched);
        expect(untouched.step).toBeNull();
        expect(untouched.events).toEqual([neighbour.entry]);
      }),
  );
});
