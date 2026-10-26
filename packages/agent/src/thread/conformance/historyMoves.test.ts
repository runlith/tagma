import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Effect } from 'effect';
import type { ThreadWriteTx } from '../ThreadPorts';
import type { Transport } from '../transport/contract';
import { NATIVE_CAPABILITIES } from '../record';
import { ThreadCallBroke } from '../ThreadBorder';
import { fakeAdapter } from './fakeTransport';
import { opened, OWNER, quiet, started, transcriptOf, until } from './compactionWorld';
import { openMemoryStorage } from './memoryStorage';

it.live(
  'a thread whose transport holds the session is told its journal moved after a rewind, a restore and a withdrawn stop, and a failing telling fails no act',
  () =>
    Effect.gen(function* () {
      const { world, storage, threadId, handle } = yield* opened(openMemoryStorage);
      const told: string[] = [];
      let refusing = false;
      const adapter = fakeAdapter(
        'hosted',
        { history: 'session', compaction: 'none' },
        {
          history: {
            restore: () => Effect.void,
            reset: () => Effect.void,
            fork: () => Effect.void,
            moved: (id) =>
              Effect.suspend(() => {
                told.push(id);
                return refusing ? Effect.fail(new ThreadCallBroke({ cause: new Error('the CLI did not stand again') })) : Effect.void;
              }),
          },
        },
      );
      yield* world.harness.runs.transports().register(adapter.transport);
      yield* storage.aggregate.update(threadId, {
        transport: { adapter: 'hosted', profile: null, agent: null },
        capabilities: { ...NATIVE_CAPABILITIES, history: 'session', compaction: 'none' },
      });
      const reports = world.harness.runs.reports().of('hosted');
      const ended = (id: string) =>
        Effect.andThen(
          Effect.sync(() => adapter.held.delete(id)),
          storage.aggregate.transaction((tx) => reports.ended({ id, threadId }, { kind: 'completed' }).run(tx as unknown as ThreadWriteTx)),
        );
      const answered = Effect.fnUntraced(function* (text: string) {
        const runId = yield* started(handle, text);
        yield* until(() => Effect.sync(() => adapter.launches.some((launch) => launch.run.id === runId)));
        yield* ended(runId);
        yield* quiet(world, threadId);
        return runId;
      });
      yield* answered('One.');
      const second = yield* answered('Two.');
      expect(told).toEqual([]);
      const rewound = yield* handle.rewind({ at: second, scope: 'from' });
      yield* until(() => Effect.sync(() => told.length === 1));
      refusing = true;
      expect(yield* handle.restore({ rewindId: rewound.rewindId })).toMatchObject({ runIds: [second] });
      yield* until(() => Effect.sync(() => told.length === 2));
      const third = yield* started(handle, 'Three.');
      yield* until(() => Effect.sync(() => adapter.launches.some((launch) => launch.run.id === third)));
      adapter.held.delete(third);
      expect(yield* handle.stop(third, { withdraw: true })).toMatchObject({ status: 'stopped', runId: third });
      yield* until(() => Effect.sync(() => told.length === 3));
      expect((yield* world.harness.reads.snapshot(threadId)).latestRun).toMatchObject({ id: third, status: 'withdrawn' });
      expect(told).toEqual([threadId, threadId, threadId]);
    }),
);

const forkedWhileGoing = Effect.fnUntraced(function* (words: Transport['words']) {
  const { world, storage, threadId, handle } = yield* opened(openMemoryStorage);
  const adapter = fakeAdapter(
    'hosted',
    { history: 'session', compaction: 'none' },
    { history: { restore: () => Effect.void, reset: () => Effect.void, fork: () => Effect.void, moved: () => Effect.void } },
  );
  yield* world.harness.runs.transports().register({ ...adapter.transport, words });
  yield* storage.aggregate.update(threadId, {
    transport: { adapter: 'hosted', profile: null, agent: null },
    capabilities: { ...NATIVE_CAPABILITIES, history: 'session', compaction: 'none' },
  });
  const reports = world.harness.runs.reports().of('hosted');
  const launched = (runId: string) => until(() => Effect.sync(() => adapter.launches.some((launch) => launch.run.id === runId)));
  const first = yield* started(handle, 'One.');
  yield* launched(first);
  adapter.held.delete(first);
  yield* storage.aggregate.transaction((tx) =>
    reports.ended({ id: first, threadId }, { kind: 'completed' }).run(tx as unknown as ThreadWriteTx),
  );
  yield* quiet(world, threadId);
  const going = yield* started(handle, 'Two.');
  yield* launched(going);
  const child = yield* world.harness.threads.duplicate({ ownerId: OWNER, sourceThreadId: threadId });
  const runsIn = (id: string) => Effect.map(transcriptOf(storage, id), (entries) => entries.map((entry) => entry.runId));
  return { first, going, source: yield* runsIn(threadId), carried: yield* runsIn(child.id) };
});

it.live(
  'a whole fork of a thread whose transport holds the session carries the conversation before its going run, which stays with the source',
  () =>
    Effect.gen(function* () {
      const { first, going, source, carried } = yield* forkedWhileGoing('opening');
      expect(source).toContain(going);
      expect(carried).toContain(first);
      expect(carried).not.toContain(going);
    }),
);

it.live('a whole fork of a thread whose transport holds the session is born before its transport has received the going words', () =>
  Effect.gen(function* () {
    const { first, carried } = yield* forkedWhileGoing('receipt');
    expect(carried).toEqual([first]);
  }),
);
