import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { TestClock } from 'effect/testing';
import { Effect, Queue, Stream } from 'effect';
import { watchResponsive } from './probe.js';
import { connect } from './session.js';

it.effect('a running probe follows CPU strain and pause, then detects a hang and recovery', () =>
  Effect.gen(function* () {
    const incoming = yield* Queue.unbounded<string>();
    const outgoing = yield* Queue.unbounded<string>();
    const reports = yield* Queue.unbounded<boolean>();
    const connection = yield* connect({ send: (text) => Effect.asVoid(Queue.offer(outgoing, text)), incoming: Stream.fromQueue(incoming) });
    let factor = 20;
    let paused = false;
    const options = { every: '1 second', threshold: '5 seconds', factor: () => factor, paused: () => paused } as const;
    yield* Effect.forkScoped(watchResponsive(connection.root, options, (responsive) => Effect.asVoid(Queue.offer(reports, responsive))));
    yield* TestClock.adjust('6 seconds');
    expect(yield* Queue.size(reports)).toBe(0);
    paused = true;
    factor = 1;
    yield* TestClock.adjust('6 seconds');
    expect(yield* Queue.size(reports)).toBe(0);
    paused = false;
    yield* TestClock.adjust('6 seconds');
    expect(yield* Queue.take(reports)).toBe(false);
    const commands = yield* Queue.takeAll(outgoing);
    const { id } = JSON.parse(commands.at(-1)!) as { readonly id: number };
    yield* Queue.offer(incoming, JSON.stringify({ id, result: { result: { type: 'number', value: 0 } } }));
    expect(yield* Queue.take(reports)).toBe(true);
  }),
);
