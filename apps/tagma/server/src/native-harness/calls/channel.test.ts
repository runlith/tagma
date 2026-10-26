import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import type { CallEvent } from '@runlith/agent/callProgress';
import { Effect, Stream } from 'effect';
import type { CallActivity } from '../contract/service/calls.js';
import { callChannel } from './channel.js';

const frames = (events: readonly CallEvent[]): CallActivity['Service'] => ({
  snapshot: () => Effect.succeed([]),
  held: () => Effect.succeed([]),
  feed: () => Stream.fromIterable(events),
  control: () => Effect.succeed({ status: 'changed', detail: null }),
  settled: () => Effect.succeed(null),
});

const channelOver = (events: readonly CallEvent[]) => callChannel({ activity: frames(events) });

it.effect('a served project’s frames ride through exactly as the owner emitted them', () =>
  Effect.gen(function* () {
    const update: CallEvent = {
      type: 'updated',
      call: {
        runId: 'run-1',
        toolCallId: 'call-1',
        threadId: 'thread-1',
        name: 'read_block',
        input: {},
        phase: 'running',
        mode: 'foreground',
        detachable: true,
        startedAt: 1_700_000_000_000,
        admittedAt: 1_700_000_000_000,
        endedAt: null,
        expiresAt: null,
        expiresBy: null,
        limitCeilingMs: null,
        detail: null,
        executions: [],
      },
    };
    const events: readonly CallEvent[] = [{ type: 'snapshot', calls: [update.call] }, update];
    const channel = channelOver(events);
    const delivered = yield* Stream.runCollect(channel['calls.subscribe']({ projectId: 1, ended: 50 }));
    expect([...delivered]).toEqual([...events]);
  }),
);
