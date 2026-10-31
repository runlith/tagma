import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import { fakeAdapter, transportsOver } from '../conformance/fakeTransport';
import { makeAggregateStorage } from '../storage/InMemoryAggregateStorage';
import { ThreadLeaseRhythm, ThreadStore } from '../ThreadPorts';
import { runBeaterLayer } from './RunBeater';
import { RunControl, runControlLayer } from './RunControl';
import { RunLifecycle } from './lifecycle/RunLifecycle';
import type { ThreadRunStopAsked } from '../storage/runs';
const INTERVAL = 5;
const unused = () => Effect.die('This heartbeat does not perform another lifecycle act.');
const ref = (id: string) => ({ id, threadId: 'thread-1' });
const beaterOver = Effect.fnUntraced(function* (adapter = fakeAdapter()) {
  const beats: (readonly string[])[] = [];
  const asked: ThreadRunStopAsked[] = [];
  const lifecycle = RunLifecycle.of({
    beat: (runs) =>
      Effect.sync(() => {
        const runIds = runs.map((run) => run.id);
        beats.push([...runIds].sort());
        return asked.filter((stop) => runIds.includes(stop.runId));
      }),
    handover: () => Effect.void,
    create: unused,
    observe: unused,
    resume: unused,
    park: unused,
    stop: unused,
    drain: unused,
    finish: unused,
    adopt: unused,
    cut: unused,
    reap: unused,
  });
  const aggregate = makeAggregateStorage();
  const built = yield* Layer.build(
    runBeaterLayer.pipe(
      Layer.provideMerge(runControlLayer),
      Layer.provide(transportsOver(adapter)),
      Layer.provide(Layer.succeed(ThreadStore, { ...aggregate, metadata: (id) => Effect.succeed(aggregate.row(id)) })),
      Layer.provide(Layer.succeed(RunLifecycle, lifecycle)),
      Layer.provide(Layer.succeed(ThreadLeaseRhythm, { heartbeatIntervalMs: INTERVAL, staleRunningAfterMs: 600, takeoverAfterMs: 15 })),
    ),
  );
  return { adapter, beats, asked, control: Context.get(built, RunControl) };
});
describe('RunBeater', () => {
  it.effect(
    'one beat covers every held run, and a run the adapter lets go is no longer beaten',
    Effect.fnUntraced(function* () {
      const { adapter, beats, control } = yield* beaterOver();
      adapter.held.add('run-1');
      adapter.held.add('run-2');
      control.drive(ref('run-1'));
      control.drive(ref('run-2'));
      yield* TestClock.adjust(INTERVAL);
      expect(beats.length).toBeGreaterThan(0);
      expect(beats.every((runIds) => runIds.join() === 'run-1,run-2')).toBe(true);
      adapter.held.delete('run-1');
      const afterLet = beats.length;
      yield* TestClock.adjust(INTERVAL);
      expect(beats.slice(afterLet)).toEqual([['run-2']]);
      adapter.held.delete('run-2');
      yield* TestClock.adjust(INTERVAL);
      const atEnd = beats.length;
      yield* TestClock.adjust(INTERVAL);
      expect(beats.length).toBe(atEnd);
    }),
  );
  it.effect(
    'a run being handed over beats before any adapter holds it, until the hand-over ends',
    Effect.fnUntraced(function* () {
      const { adapter, beats, control } = yield* beaterOver();
      const released = control.launching(ref('run-1'));
      yield* TestClock.adjust(INTERVAL);
      expect(beats.length).toBeGreaterThan(0);
      expect(control.holds('run-1')).toBe(true);
      adapter.held.add('run-1');
      released();
      expect(control.holds('run-1')).toBe(true);
      adapter.held.delete('run-1');
      expect(control.holds('run-1')).toBe(false);
    }),
  );
  it.effect(
    'run counts follow drives, hand-overs and the holdings observed by the next beat',
    Effect.fnUntraced(function* () {
      const { adapter, control } = yield* beaterOver();
      const counts: number[] = [];
      control.onChange((going) => counts.push(going));
      expect(counts).toEqual([0]);
      adapter.held.add('run-1');
      control.drive(ref('run-1'));
      const released = control.launching(ref('run-2'));
      expect(counts).toEqual([0, 1, 2]);
      released();
      expect(counts.at(-1)).toBe(1);
      adapter.held.delete('run-1');
      yield* TestClock.adjust(INTERVAL);
      expect(counts.at(-1)).toBe(0);
    }),
  );
  it.effect(
    'a stop another process asked for reaches the held run at the next beat',
    Effect.fnUntraced(function* () {
      const { adapter, asked, control } = yield* beaterOver();
      adapter.held.add('run-1');
      adapter.held.add('run-2');
      control.drive(ref('run-1'));
      control.drive(ref('run-2'));
      asked.push({ runId: 'run-2', by: 'reader' });
      yield* TestClock.adjust(INTERVAL);
      expect([...new Set(adapter.interrupted)]).toEqual(['run-2']);
    }),
  );
  it.effect(
    'an outstanding stop holds no beat and is asked once while it lands',
    Effect.fnUntraced(function* () {
      const slow = fakeAdapter();
      slow.transport.runs.interrupt = (runId) =>
        Effect.andThen(
          Effect.sync(() => void slow.interrupted.push(runId)),
          Effect.never,
        );
      const { adapter, asked, beats, control } = yield* beaterOver(slow);
      adapter.held.add('run-1');
      adapter.held.add('run-2');
      control.drive(ref('run-1'));
      control.drive(ref('run-2'));
      asked.push({ runId: 'run-2', by: 'reader' });
      yield* TestClock.adjust(INTERVAL);
      const atAsk = beats.length;
      yield* TestClock.adjust(INTERVAL * 2);
      expect(beats.length - atAsk).toBe(2);
      expect(adapter.interrupted).toEqual(['run-2']);
    }),
  );
  it.effect(
    'a run nobody drives is not beaten even when the adapter holds it',
    Effect.fnUntraced(function* () {
      const { adapter, beats } = yield* beaterOver();
      adapter.held.add('run-1');
      yield* TestClock.adjust(INTERVAL);
      expect(beats).toEqual([]);
    }),
  );
});
