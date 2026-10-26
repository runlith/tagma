import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { fakeAdapter } from '../conformance/fakeTransport';
import { NATIVE_BINDING } from '../record';
import { Transports, transportsLayer } from './Transports';
layer(transportsLayer)('Transports', (it) => {
  it.effect(
    'refuses registrations whose declaration and services diverge, and resolves bindings',
    Effect.fnUntraced(function* () {
      const transports = yield* Transports;
      const history = {
        restore: () => Effect.void,
        reset: () => Effect.void,
        fork: () => Effect.void,
        moved: () => Effect.void,
      };
      const claiming = yield* Effect.flip(transports.register(fakeAdapter('acp', { history: 'session', compaction: 'none' }).transport));
      const holding = yield* Effect.flip(
        transports.register(fakeAdapter('terminal', { history: 'journal', compaction: 'core' }, { history }).transport),
      );
      expect(claiming).toMatchObject({ _tag: 'TransportMismatch', adapter: 'acp', subject: 'TransportHistory', declared: true });
      expect(holding).toMatchObject({ _tag: 'TransportMismatch', adapter: 'terminal', subject: 'TransportHistory', declared: false });
      expect(transports.all()).toEqual([]);
      const native = fakeAdapter('native');
      yield* transports.register(native.transport);
      expect(yield* transports.of(NATIVE_BINDING)).toBe(native.transport);
      expect(yield* Effect.flip(transports.register(fakeAdapter('native').transport))).toMatchObject({
        _tag: 'TransportRegistered',
        adapter: 'native',
      });
      expect(yield* Effect.flip(transports.of({ adapter: 'terminal', profile: null, agent: null }))).toMatchObject({
        _tag: 'TransportUnregistered',
        adapter: 'terminal',
      });
    }),
  );
});
