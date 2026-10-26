import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { RpcSerialization } from 'effect/rpc';
import { liveSerialization } from '../../platform/contract/wire/live.js';
import { appliedCommandFeed, commandFeedDelta } from './feedDelta.js';
import { CommandFeedDelta, type CommandFeedSnapshot } from '../contract/wire/commandFeed.js';
import { CommandCursor, type CommandReading } from '../contract/wire/commands.js';

const policy = { tool: 'bash', requested: 20_000, rules: [{ id: 'd88b38f2', limitMs: 60_000, words: 'one minute at most' }] };

const reading = (execution: string, taken?: number, current?: string): CommandReading =>
  ({
    command: { projectId: 1, execution: { installation: 'inst', execution, incarnation: 0 }, admittedAt: 1, time: policy },
    live: {
      _tag: 'Held',
      readAt: 1,
      entry: {
        admission: { policyIdentity: 'policy', ...policy },
        state: { phase: taken === undefined ? 'ended' : 'running' },
        usage: taken === undefined ? undefined : { execution: { installation: 'inst', execution, incarnation: 0 }, takenAtMicros: taken },
      },
    },
    current: current === undefined ? undefined : { identity: { pid: 7 }, command: current },
  }) as unknown as CommandReading;

const snapshot = (over: Partial<CommandFeedSnapshot>): CommandFeedSnapshot =>
  ({
    projectId: 1,
    composedAt: 1,
    active: [],
    ended: [],
    terminals: [],
    host: { _tag: 'Answered', unmeasured: [] },
    stale: false,
    operationKeys: { retained: 1 },
    ...over,
  }) as unknown as CommandFeedSnapshot;

test('a change applied to the reading it was taken over is the newer reading, and every untouched row stays the same object', () => {
  const before = snapshot({
    active: [reading('live-1', 1), reading('live-2', 1)],
    ended: [reading('old-3'), reading('old-2'), reading('old-1')],
    endedAfter: 'cursor-1' as never,
  });
  const after = snapshot({
    composedAt: 2,
    active: [reading('live-1', 1), reading('live-2', 5, 'bun test'), reading('live-4', 1)],
    ended: [reading('old-3'), reading('live-0'), reading('old-2')],
    terminals: [{ record: { execution: { execution: 'term-1', incarnation: 0 } } }] as never,
    stale: true,
  });

  const delta = commandFeedDelta(before, after);
  const applied = delta === undefined ? undefined : appliedCommandFeed(before, delta);

  expect(applied).toEqual(after);
  expect(applied?.active[0]).toBe(before.active[0] as CommandReading);
  expect(applied?.ended[0]).toBe(before.ended[0] as CommandReading);
  expect(applied?.ended[2]).toBe(before.ended[1] as CommandReading);
  expect(delta?.active?.readings.map((one) => one.command.execution.execution as string)).toEqual(['live-4']);
  expect(delta?.active?.measured.map((one) => one.key)).toEqual(['live-2:0']);
  expect(delta?.ended?.readings.map((one) => one.command.execution.execution as string)).toEqual(['live-0']);
});

it.effect('the live RPC delta keeps an omitted cursor, clears explicit null and refuses undefined before transmission', () =>
  Effect.gen(function* () {
    const codec = (yield* Effect.provide(RpcSerialization.RpcSerialization, liveSerialization)).codecFor(CommandFeedDelta);
    const encode = Schema.encodeSync(codec);
    const decode = Schema.decodeUnknownEffect(codec);
    const cursor = CommandCursor.make('cursor-1');
    const before = snapshot({ endedAfter: cursor });
    const transmitted = (delta: typeof CommandFeedDelta.Type) => decode(JSON.parse(JSON.stringify(encode(delta))));

    expect(appliedCommandFeed(before, yield* transmitted({ composedAt: 2, stale: true }))?.endedAfter).toBe(cursor);
    expect(appliedCommandFeed(before, yield* transmitted({ composedAt: 2, endedAfter: null }))?.endedAfter).toBeUndefined();
    expect(Schema.encodeUnknownResult(codec)({ composedAt: 2, endedAfter: undefined })._tag).toBe('Failure');
  }),
);

test('a reading that moved only in time is no change, and a change is refused over a reading that lacks the rows it names', () => {
  const before = snapshot({ active: [reading('live-1', 1)], ended: [reading('old-1')] });
  const later = snapshot({ composedAt: 9, active: [reading('live-1', 1)], ended: [reading('old-1')] });
  const measured = snapshot({ composedAt: 9, active: [reading('live-1', 2)], ended: [reading('old-1')] });
  const reordered = snapshot({ composedAt: 9, active: [reading('live-1', 1)], ended: [reading('old-2'), reading('old-1')] });

  const measuring = commandFeedDelta(before, measured);
  const ordering = commandFeedDelta(before, reordered);

  expect(commandFeedDelta(before, later)).toBeUndefined();
  expect(measuring === undefined ? undefined : appliedCommandFeed(snapshot({ active: [reading('live-9', 1)] }), measuring)).toBeUndefined();
  expect(ordering === undefined ? undefined : appliedCommandFeed(snapshot({ ended: [reading('old-7')] }), ordering)).toBeUndefined();
});
