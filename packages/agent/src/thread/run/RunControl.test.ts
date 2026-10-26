import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { fakeAdapter, transportsOver } from '../conformance/fakeTransport';
import { makeAggregateStorage } from '../storage/InMemoryAggregateStorage';
import { ThreadStore } from '../ThreadPorts';
import { RunControl, runControlLayer } from './RunControl';

const native = fakeAdapter('native');
const acp = fakeAdapter('acp');
const aggregate = makeAggregateStorage();
const store = Layer.succeed(ThreadStore, { ...aggregate, metadata: (id) => Effect.succeed(aggregate.row(id)) });

layer(runControlLayer.pipe(Layer.provide(Layer.merge(transportsOver(native, acp), store))))('RunControl', (it) => {
  it.effect(
    'interrupts a turn at the transport holding it, and a turn nobody holds only at the transport its thread is bound to',
    Effect.fnUntraced(function* () {
      const control = yield* RunControl;
      acp.held.add('run-held');
      expect(yield* control.interrupt({ id: 'run-held', threadId: 'thread-1' }, 'reader')).toBe('interrupted');
      expect(acp.interrupted).toEqual(['run-held']);
      expect(native.interrupted).toEqual([]);
      expect(yield* control.interrupt({ id: 'run-orphan', threadId: 'thread-1' }, 'reader')).toBe('no-turn');
      expect(native.interrupted).toEqual(['run-orphan']);
      expect(acp.interrupted).toEqual(['run-held']);
    }),
  );
});
