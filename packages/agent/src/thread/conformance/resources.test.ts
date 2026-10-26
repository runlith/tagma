import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { openMemoryStorage } from './memoryStorage';
import { describeThreadResourceLedgerPort } from './resources';

describeThreadResourceLedgerPort('InMemory', openMemoryStorage, it.live);

it.effect(
  'a resource records when it was first held and keeps that time on a repeat',
  Effect.fnUntraced(function* () {
    const { resources, createThread } = yield* openMemoryStorage();
    const thread = yield* createThread({ ownerId: 'owner', scope: 'scope' });
    const values = { kind: 'scratch', id: 'directory', threadId: thread.id };
    const heldAt = yield* Clock.currentTimeMillis;
    expect((yield* resources.hold(values)).heldAt.getTime()).toBe(heldAt);
    yield* TestClock.adjust('100 millis');
    expect((yield* resources.hold(values)).heldAt.getTime()).toBe(heldAt);
  }),
);
